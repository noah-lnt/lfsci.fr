import { createOdooClient } from "@lfsci/odoo";
import { describe, expect, it } from "vitest";
import { SourceUnreachable } from "../src/model";
import { createOdooSource } from "../src/sources/odoo";
import { fakeOdoo, seedLedger } from "./helpers";

describe("odoo source", () => {
  it("reads partners, invoices and bank lines through the connector and maps each one", async () => {
    const { server, client } = fakeOdoo();
    seedLedger(server);
    // Odoo 18 Community answers a fault for the Enterprise-only model (measured 2026-09-20).
    server.handle("account.asset", "search_read", () => {
      throw new Error("Object account.asset doesn't exist");
    });
    const read = await createOdooSource({
      client,
      now: () => new Date("2026-09-20T08:00:00Z"),
    }).read();

    expect(read.found).toBe(4 + 6 + 1);
    const kinds = read.records.map((r) => `${r.kind}:${r.ref}`);
    expect(kinds).toEqual([
      "person:res.partner:13",
      "supplier:res.partner:14",
      "person:res.partner:15",
      "rent_term:account.move:55",
      "rent_term:account.move:58",
      "rent_term:account.move:61",
      "expense:account.move:70",
      "bank_line:account.bank.statement.line:1",
    ]);
    expect(read.records[3]).toMatchObject({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      dueOn: "2026-07-05",
      total: "780.00",
      residual: "0.00",
      settled: true,
      odooMoveName: "INV/2026/00023",
    });
    expect(read.records[4]).toMatchObject({ settled: false, residual: "400.00" });
    expect(read.records[6]).toMatchObject({
      totalInclTax: "312.50",
      paid: true,
      supplierName: "Plombier Dupuis SARL",
    });
    expect(read.rejections).toEqual([
      expect.objectContaining({ ref: "account.move:60", reason: "not_posted" }),
      expect.objectContaining({ ref: "account.move:71", reason: "missing_field" }),
    ]);
    expect(read.coverage).toEqual({ from: "2026-06-12", to: "2026-09-01" });
    expect(read.notes.some((note) => note.includes("account.asset non lisible"))).toBe(true);
    expect(server.calls.every((call) => call.method === "search_read")).toBe(true);
  });

  it("cannot look when the server is unreachable", async () => {
    const client = createOdooClient({
      baseUrl: "http://127.0.0.1:9",
      apiKey: "x",
      database: "x",
      transport: "jsonrpc",
      login: "x",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
    });
    const error = await createOdooSource({ client })
      .read()
      .then(
        () => null,
        (value: unknown) => value,
      );
    expect(error).toBeInstanceOf(SourceUnreachable);
    expect(String((error as Error).message)).toContain("res.partner");
  });
});
