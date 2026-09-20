"use client";

import type { DocumentLinkRelation, ObjectRef } from "@lfsci/contracts";
import { useCallback, useState } from "react";
import { MAX_UPLOAD_BYTES } from "@/lib/contracts/documents";
import { rpc } from "@/lib/rpc";

export type QueueState = "local" | "uploading" | "synced" | "failed";

export type QueueItem = {
  id: string;
  filename: string;
  size: number;
  state: QueueState;
  /** Correlation reference of the last failure, printed next to the retry. */
  requestId?: string;
};

export type UploadTarget = { object?: ObjectRef; relation?: DocumentLinkRelation; nature: string };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class UploadRejected extends Error {
  constructor(readonly reason: "tooLarge" | "unsupported") {
    super(reason);
  }
}

const ACCEPTED = /^(application\/pdf|image\/(png|jpeg|webp|heic))$/;

/**
 * UX-03 in-memory form: the file is held in this tab until the PUT succeeds.
 * The durable IndexedDB queue is out of scope here — a reload loses what is
 * still `local`, which is why the panel warns while anything is pending.
 */
export function useUploadQueue(target: UploadTarget) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [pending, setPending] = useState<Map<string, File>>(new Map());

  const patch = useCallback((id: string, changes: Partial<QueueItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const send = useCallback(
    async (id: string, file: File) => {
      patch(id, { state: "uploading" });
      const buffer = await file.arrayBuffer();
      const sha256 = await sha256Hex(buffer);
      const contentType = file.type || "application/octet-stream";

      const upload = await rpc.documents.createUpload({
        filename: file.name,
        contentType,
        contentLength: file.size,
        sha256,
      });

      // content-length is a forbidden header in the browser; the store derives it.
      const headers = Object.fromEntries(
        Object.entries(upload.headers).filter(([key]) => key.toLowerCase() !== "content-length"),
      );
      const response = await fetch(upload.url, { method: "PUT", headers, body: buffer });
      if (!response.ok) throw new Error(`upload failed with ${response.status}`);

      await rpc.documents.finalizeUpload({
        uploadId: upload.uploadId,
        documentId: upload.documentId,
        sha256,
        contentLength: file.size,
        metadata: {
          title: file.name,
          nature: target.nature,
          ...(target.object
            ? { links: [{ relation: target.relation ?? "attached", object: target.object }] }
            : {}),
        },
      });

      patch(id, { state: "synced" });
      setPending((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    },
    [patch, target.nature, target.object, target.relation],
  );

  const enqueue = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > MAX_UPLOAD_BYTES) throw new UploadRejected("tooLarge");
      if (!ACCEPTED.test(file.type)) throw new UploadRejected("unsupported");

      const id = crypto.randomUUID();
      setItems((current) => [
        { id, filename: file.name, size: file.size, state: "local" },
        ...current,
      ]);
      setPending((current) => new Map(current).set(id, file));
      await send(id, file);
    },
    [send],
  );

  const retry = useCallback(
    async (id: string): Promise<void> => {
      const file = pending.get(id);
      if (!file) return;
      await send(id, file);
    },
    [pending, send],
  );

  const fail = useCallback(
    (id: string, requestId: string) => patch(id, { state: "failed", requestId }),
    [patch],
  );

  return {
    items,
    enqueue,
    retry,
    fail,
    unsynced: items.filter((item) => item.state !== "synced").length,
  };
}
