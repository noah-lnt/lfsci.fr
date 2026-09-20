"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { useSessionOrganizationId } from "@/components/layout/organization-context";
import { MAX_UPLOAD_BYTES } from "@/lib/contracts/documents";
import { errorPayload, rpc } from "@/lib/rpc";
import { flushQueue, MAX_AUTO_ATTEMPTS } from "@/lib/upload/flush";
import { sha256Hex } from "@/lib/upload/hash";
import {
  openQueueStore,
  type QueueEntry,
  type QueueStore,
  type UploadTarget,
} from "@/lib/upload/queue-store";
import { uploadEntry } from "@/lib/upload/send";

export type { UploadTarget };

export type QueueState = "local" | "uploading" | "synced" | "failed" | "blocked";

export type QueueItem = {
  id: string;
  filename: string;
  size: number;
  capturedAt: string;
  attempts: number;
  state: QueueState;
  /** Correlation reference of the last failure, printed next to the retry. */
  requestId?: string;
};

export class UploadRejected extends Error {
  constructor(readonly reason: "tooLarge" | "unsupported" | "noOrganization") {
    super(reason);
  }
}

const ACCEPTED = /^(application\/pdf|image\/(png|jpeg|webp|heic))$/;

// One connection and one pass per tab: several capture panels can be mounted at
// once, and two of them flushing the same entry would upload it twice.
let shared: Promise<QueueStore> | null = null;
let inFlight: Promise<unknown> | null = null;

function sharedStore(): Promise<QueueStore> {
  shared ??= openQueueStore();
  return shared;
}

function toItem(entry: QueueEntry, state: QueueState): QueueItem {
  return {
    id: entry.id,
    filename: entry.filename,
    size: entry.size,
    capturedAt: entry.capturedAt,
    attempts: entry.attempts,
    state,
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
  };
}

function stateOf(entry: QueueEntry, activeId: string | null): QueueState {
  if (entry.id === activeId) return "uploading";
  if (entry.attempts >= MAX_AUTO_ATTEMPTS) return "blocked";
  return entry.attempts > 0 ? "failed" : "local";
}

/**
 * UX-03: the capture is written to IndexedDB before anything is sent, so a tab
 * closed in a cellar keeps the file, its target and its retry state.
 */
export function useUploadQueue(target: UploadTarget, onSynced?: () => void) {
  const syncedRef = useRef(onSynced);

  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [sent, setSent] = useState<QueueItem[]>([]);
  const [onDevice, setOnDevice] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [durable, setDurable] = useState(true);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    syncedRef.current = onSynced;
  }, [onSynced]);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => rpc.me.get(),
    staleTime: 5 * 60_000,
    retry: 3,
  });
  const refetchMe = me.refetch;
  const sessionOrganizationId = useSessionOrganizationId();
  const organizationId = sessionOrganizationId ?? me.data?.activeOrganizationId ?? null;
  // The handlers below may run from a render that predates the session answer,
  // so they read the organization through this ref, never through the closure.
  const organizationRef = useRef(organizationId);
  organizationRef.current = organizationId;

  const refresh = useCallback(async (): Promise<void> => {
    const store = await sharedStore();
    const owner = organizationRef.current;
    setDurable(store.durable());
    setOnDevice(await store.count());
    setEntries(owner ? await store.list(owner) : []);
  }, []);

  const runPass = useCallback(
    async (owner: string, only?: string): Promise<void> => {
      // A pass that started before this capture was written will not see it:
      // wait for it, then run a pass of our own.
      while (inFlight) await inFlight.catch(() => undefined);
      inFlight = sharedStore().then((store) =>
        flushQueue({
          store,
          organizationId: owner,
          send: uploadEntry,
          ...(only ? { only } : {}),
          onAttempt: (entry) => setActiveId(entry.id),
          onSent: (entry) => {
            setSent((current) => [toItem(entry, "synced"), ...current]);
            syncedRef.current?.();
          },
          requestIdOf: (cause) => {
            const { requestId } = errorPayload(cause);
            return requestId === "—" ? undefined : requestId;
          },
        }),
      );
      try {
        await inFlight;
      } finally {
        inFlight = null;
        setActiveId(null);
        await refresh();
      }
    },
    [refresh],
  );

  const flush = useCallback(
    async (only?: string): Promise<void> => {
      const owner = organizationRef.current;
      if (owner) await runPass(owner, only);
    },
    [runPass],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the session answer is what makes a first pass possible
  useEffect(() => {
    void refresh();
    void flush();
  }, [flush, refresh, organizationId]);

  useEffect(() => {
    setOnline(navigator.onLine);

    const back = (): void => {
      setOnline(true);
      if (!organizationId) void refetchMe();
      void flush();
    };
    const lost = (): void => setOnline(false);
    const woken = (): void => {
      if (document.visibilityState !== "visible") return;
      setOnline(navigator.onLine);
      if (navigator.onLine) back();
    };

    window.addEventListener("online", back);
    window.addEventListener("offline", lost);
    document.addEventListener("visibilitychange", woken);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", lost);
      document.removeEventListener("visibilitychange", woken);
    };
  }, [flush, organizationId, refetchMe]);

  const enqueue = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > MAX_UPLOAD_BYTES) throw new UploadRejected("tooLarge");
      if (!ACCEPTED.test(file.type)) throw new UploadRejected("unsupported");
      // A capture right after sign-in can land before the session query answered.
      const owner = organizationId ?? (await refetchMe()).data?.activeOrganizationId ?? null;
      if (!owner) throw new UploadRejected("noOrganization");

      const bytes = await file.arrayBuffer();
      const entry: QueueEntry = {
        id: uuidv7(),
        organizationId: owner,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        sha256: await sha256Hex(bytes),
        capturedAt: new Date().toISOString(),
        attempts: 0,
        target: {
          nature: target.nature,
          ...(target.object ? { object: target.object } : {}),
          ...(target.relation ? { relation: target.relation } : {}),
        },
        bytes,
      };

      const store = await sharedStore();
      await store.put(entry);
      await refresh();
      await runPass(owner);
    },
    [organizationId, refetchMe, refresh, runPass, target.nature, target.object, target.relation],
  );

  const retry = useCallback(async (id: string): Promise<void> => flush(id), [flush]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const store = await sharedStore();
      await store.remove(id);
      await refresh();
    },
    [refresh],
  );

  const items = useMemo(
    () => [...entries.map((entry) => toItem(entry, stateOf(entry, activeId))), ...sent],
    [activeId, entries, sent],
  );

  return {
    items,
    enqueue,
    retry,
    remove,
    durable,
    online,
    unsynced: entries.length,
    /** Captures held for another session on this browser, shown when the organization is unknown. */
    onDevice: organizationId ? 0 : onDevice,
  };
}
