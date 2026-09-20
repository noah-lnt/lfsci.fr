import type { DocumentLinkRelation, ObjectRef } from "@lfsci/contracts";

export type UploadTarget = { object?: ObjectRef; relation?: DocumentLinkRelation; nature: string };

export type QueueEntry = {
  id: string;
  organizationId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  /** ISO-8601 instant of the capture, not of the send. */
  capturedAt: string;
  attempts: number;
  requestId?: string;
  target: UploadTarget;
  bytes: ArrayBuffer;
};

export type QueueStore = {
  /** False once a read or a write failed: the queue then lives in this tab only. */
  durable: () => boolean;
  list: (organizationId: string) => Promise<QueueEntry[]>;
  count: () => Promise<number>;
  put: (entry: QueueEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  complete: (entry: QueueEntry) => Promise<void>;
  isCompleted: (organizationId: string, sha256: string) => Promise<boolean>;
};

const DB_NAME = "lfsci-capture-queue";
const DB_VERSION = 1;
const ENTRIES = "entries";
const COMPLETED = "completed";
const COMPLETION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type CompletionRecord = { organizationId: string; sha256: string; completedAt: string };

function completionKey(organizationId: string, sha256: string): string {
  return `${organizationId}:${sha256}`;
}

export function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(COMPLETED)) db.createObjectStore(COMPLETED);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb open refused"));
    request.onblocked = () => reject(new Error("indexeddb open blocked"));
  });
}

async function defaultOpen(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("indexeddb unavailable");
  return openDatabase(indexedDB);
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

function read<T>(
  db: IDBDatabase,
  storeName: string,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const tx = db.transaction(storeName, "readonly");
  return awaitRequest(work(tx.objectStore(storeName)));
}

/**
 * A quota refusal surfaces as an abort on the transaction, never on the request,
 * so a write is only durable once the transaction itself has completed.
 */
function write(
  db: IDBDatabase,
  storeNames: string[],
  work: (tx: IDBTransaction) => void,
): Promise<void> {
  const tx = db.transaction(storeNames, "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb transaction failed"));
  });
  work(tx);
  return done;
}

export type QueueStoreOptions = {
  /** Injected by the tests; the default opens the browser's own database. */
  open?: () => Promise<IDBDatabase>;
};

export async function openQueueStore(options: QueueStoreOptions = {}): Promise<QueueStore> {
  const memory = new Map<string, QueueEntry>();
  const completed = new Set<string>();
  let db: IDBDatabase | null = null;

  try {
    db = await (options.open ?? defaultOpen)();
  } catch {
    db = null;
  }

  function degrade(): void {
    const closing = db;
    db = null;
    try {
      closing?.close();
    } catch {
      return;
    }
  }

  async function prune(): Promise<void> {
    if (!db) return;
    try {
      const rows = await read<CompletionRecord[]>(db, COMPLETED, (store) => store.getAll());
      const stale = rows.filter((row) => {
        const at = Date.parse(row.completedAt);
        return Number.isFinite(at) && Date.now() - at > COMPLETION_RETENTION_MS;
      });
      if (stale.length === 0) return;
      await write(db, [COMPLETED], (tx) => {
        for (const row of stale) {
          tx.objectStore(COMPLETED).delete(completionKey(row.organizationId, row.sha256));
        }
      });
    } catch {
      degrade();
    }
  }

  await prune();

  return {
    durable: () => db !== null,

    async list(organizationId) {
      if (db) {
        try {
          const rows = await read<QueueEntry[]>(db, ENTRIES, (store) => store.getAll());
          memory.clear();
          for (const row of rows) memory.set(row.id, row);
        } catch {
          degrade();
        }
      }
      return [...memory.values()]
        .filter((entry) => entry.organizationId === organizationId)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
    },

    async count() {
      if (db) {
        try {
          return await read<number>(db, ENTRIES, (store) => store.count());
        } catch {
          degrade();
        }
      }
      return memory.size;
    },

    async put(entry) {
      memory.set(entry.id, entry);
      if (!db) return;
      try {
        await write(db, [ENTRIES], (tx) => {
          tx.objectStore(ENTRIES).put(entry);
        });
      } catch {
        degrade();
      }
    },

    async remove(id) {
      memory.delete(id);
      if (!db) return;
      try {
        await write(db, [ENTRIES], (tx) => {
          tx.objectStore(ENTRIES).delete(id);
        });
      } catch {
        degrade();
      }
    },

    async complete(entry) {
      const key = completionKey(entry.organizationId, entry.sha256);
      completed.add(key);
      // The completion is committed before the entry is dropped: a crash in
      // between replays an entry the hash then refuses, never a second upload.
      if (db) {
        try {
          const record: CompletionRecord = {
            organizationId: entry.organizationId,
            sha256: entry.sha256,
            completedAt: new Date().toISOString(),
          };
          await write(db, [COMPLETED], (tx) => {
            tx.objectStore(COMPLETED).put(record, key);
          });
        } catch {
          degrade();
        }
      }
      memory.delete(entry.id);
      if (!db) return;
      try {
        await write(db, [ENTRIES], (tx) => {
          tx.objectStore(ENTRIES).delete(entry.id);
        });
      } catch {
        degrade();
      }
    },

    async isCompleted(organizationId, sha256) {
      const key = completionKey(organizationId, sha256);
      if (completed.has(key)) return true;
      if (!db) return false;
      try {
        const row = await read<CompletionRecord | undefined>(db, COMPLETED, (store) =>
          store.get(key),
        );
        return row !== undefined;
      } catch {
        degrade();
        return false;
      }
    },
  };
}
