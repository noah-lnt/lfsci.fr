import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, openQueueStore, type QueueEntry } from "./queue-store";

const OWN = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

let factory: IDBFactory;

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "01990000-0000-7000-8000-000000000001",
    organizationId: OWN,
    filename: "ticket.png",
    contentType: "image/png",
    size: 3,
    sha256: "a".repeat(64),
    capturedAt: "2026-09-20T08:00:00.000Z",
    attempts: 0,
    target: { nature: "to_qualify" },
    bytes: new Uint8Array([1, 2, 3]).buffer,
    ...overrides,
  };
}

/** A tab reopened on the same browser profile: a new store over the same database. */
function reload() {
  return openQueueStore({ open: () => openDatabase(factory) });
}

/** What a browser out of quota does: the write transaction never commits. */
function refusingWrites(db: IDBDatabase): IDBDatabase {
  return new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return (names: string | string[], mode?: IDBTransactionMode) => {
          if (mode === "readwrite") throw new DOMException("quota", "QuotaExceededError");
          return target.transaction(names, mode);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeEach(() => {
  factory = new IDBFactory();
});

describe("capture queue store", () => {
  it("hands back a capture written by a previous tab", async () => {
    const store = await reload();
    await store.put(entry({ capturedAt: "2026-09-20T08:00:00.000Z" }));
    expect(store.durable()).toBe(true);

    const reopened = await reload();
    const pending = await reopened.list(OWN);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.filename).toBe("ticket.png");
    expect(pending[0]?.capturedAt).toBe("2026-09-20T08:00:00.000Z");
    expect(new Uint8Array(pending[0]?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("keeps the retry state of a failed capture", async () => {
    const store = await reload();
    await store.put(entry());
    await store.put(entry({ attempts: 2, requestId: "0199-req" }));

    const pending = await (await reload()).list(OWN);
    expect(pending[0]?.attempts).toBe(2);
    expect(pending[0]?.requestId).toBe("0199-req");
  });

  it("falls back to memory when the browser refuses the write", async () => {
    const store = await openQueueStore({
      open: async () => refusingWrites(await openDatabase(factory)),
    });
    await store.put(entry());

    expect(store.durable()).toBe(false);
    expect(await store.list(OWN)).toHaveLength(1);
    expect(await (await reload()).list(OWN)).toHaveLength(0);
  });

  it("stays usable when site data is blocked altogether", async () => {
    const store = await openQueueStore({
      open: () => Promise.reject(new DOMException("blocked", "SecurityError")),
    });

    expect(store.durable()).toBe(false);
    await store.put(entry());
    expect(await store.list(OWN)).toHaveLength(1);
  });

  it("never lists a capture belonging to another organization", async () => {
    const store = await reload();
    await store.put(entry({ organizationId: OTHER }));

    const reopened = await reload();
    expect(await reopened.list(OWN)).toHaveLength(0);
    expect(await reopened.count()).toBe(1);
    expect(await reopened.isCompleted(OWN, "a".repeat(64))).toBe(false);
  });

  it("records the completion before dropping the entry", async () => {
    const store = await reload();
    const captured = entry();
    await store.put(captured);
    await store.complete(captured);

    const reopened = await reload();
    expect(await reopened.list(OWN)).toHaveLength(0);
    expect(await reopened.isCompleted(OWN, captured.sha256)).toBe(true);
    expect(await reopened.isCompleted(OTHER, captured.sha256)).toBe(false);
  });
});
