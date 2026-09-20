import type { QueueEntry, QueueStore } from "./queue-store";

/** Past this, only an explicit retry sends again: a poison capture never loops. */
export const MAX_AUTO_ATTEMPTS = 5;

export type FlushResult = { sent: number; duplicates: number; failed: number; blocked: number };

export type FlushOptions = {
  store: QueueStore;
  organizationId: string;
  send: (entry: QueueEntry) => Promise<void>;
  /** Restricts the pass to one entry and ignores the attempt ceiling. */
  only?: string;
  maxAttempts?: number;
  onAttempt?: (entry: QueueEntry) => void;
  onSent?: (entry: QueueEntry) => void;
  requestIdOf?: (cause: unknown) => string | undefined;
};

export async function flushQueue(options: FlushOptions): Promise<FlushResult> {
  const { store, organizationId, send, only } = options;
  const ceiling = options.maxAttempts ?? MAX_AUTO_ATTEMPTS;
  const result: FlushResult = { sent: 0, duplicates: 0, failed: 0, blocked: 0 };

  const entries = await store.list(organizationId);
  for (const entry of entries) {
    if (only !== undefined && entry.id !== only) continue;
    if (only === undefined && entry.attempts >= ceiling) {
      result.blocked += 1;
      continue;
    }
    if (await store.isCompleted(organizationId, entry.sha256)) {
      await store.remove(entry.id);
      result.duplicates += 1;
      continue;
    }

    options.onAttempt?.(entry);
    try {
      await send(entry);
      await store.complete(entry);
      options.onSent?.(entry);
      result.sent += 1;
    } catch (cause) {
      const requestId = options.requestIdOf?.(cause);
      await store.put({
        ...entry,
        attempts: entry.attempts + 1,
        ...(requestId ? { requestId } : {}),
      });
      result.failed += 1;
    }
  }

  return result;
}
