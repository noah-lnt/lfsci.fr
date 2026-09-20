import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushQueue, MAX_AUTO_ATTEMPTS } from "./flush";
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

function reload() {
  return openQueueStore({ open: () => openDatabase(factory) });
}

beforeEach(() => {
  factory = new IDBFactory();
});

describe("capture queue flush", () => {
  it("sends a pending capture once and never again after a reload", async () => {
    const send = vi.fn(async () => undefined);
    const store = await reload();
    await store.put(entry());

    const first = await flushQueue({ store, organizationId: OWN, send });
    expect(first).toEqual({ sent: 1, duplicates: 0, failed: 0, blocked: 0 });

    const reopened = await reload();
    const second = await flushQueue({ store: reopened, organizationId: OWN, send });
    expect(second.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drops a capture whose hash the server already holds", async () => {
    const send = vi.fn(async () => undefined);
    const store = await reload();
    await store.put(entry());
    await flushQueue({ store, organizationId: OWN, send });

    // The same photo captured again: the completion record refuses the second send.
    const again = await reload();
    await again.put(entry({ id: "01990000-0000-7000-8000-000000000002" }));
    const result = await flushQueue({ store: again, organizationId: OWN, send });

    expect(result).toEqual({ sent: 0, duplicates: 1, failed: 0, blocked: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await again.list(OWN)).toHaveLength(0);
  });

  it("ignores a capture queued under another organization", async () => {
    const send = vi.fn(async () => undefined);
    const store = await reload();
    await store.put(entry({ organizationId: OTHER }));

    const result = await flushQueue({ store: await reload(), organizationId: OWN, send });

    expect(result.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a refused capture with its attempt count and correlation reference", async () => {
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    const store = await reload();
    await store.put(entry());

    const result = await flushQueue({
      store,
      organizationId: OWN,
      send,
      requestIdOf: () => "0199-req",
    });

    expect(result.failed).toBe(1);
    const kept = await (await reload()).list(OWN);
    expect(kept[0]?.attempts).toBe(1);
    expect(kept[0]?.requestId).toBe("0199-req");
  });

  it("stops retrying a poison capture on its own, but still obeys an explicit retry", async () => {
    const send = vi.fn(async () => {
      throw new Error("refused");
    });
    const store = await reload();
    await store.put(entry({ attempts: MAX_AUTO_ATTEMPTS }));

    expect(await flushQueue({ store, organizationId: OWN, send })).toEqual({
      sent: 0,
      duplicates: 0,
      failed: 0,
      blocked: 1,
    });
    expect(send).not.toHaveBeenCalled();

    const forced = await flushQueue({
      store,
      organizationId: OWN,
      send,
      only: "01990000-0000-7000-8000-000000000001",
    });
    expect(forced.failed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
