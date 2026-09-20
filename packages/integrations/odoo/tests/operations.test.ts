import { isAppError, runWithCorrelation } from "@lfsci/kernel";
import type { CapabilitySnapshot } from "@lfsci/odoo";
import { createOdooOperations, newOperationRef } from "@lfsci/odoo";
import { describe, expect, it } from "vitest";
import { noRetry, seedMoves, setup } from "./helpers";

async function caught(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (value: unknown) => value,
  );
  if (!isAppError(error)) throw new Error(`expected an AppError, received ${String(error)}`);
  return error;
}

describe("partners", () => {
  it("creates a partner carrying the stable operation reference", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client);
    const { id, operationRef } = await operations.createPartner({
      name: "Fournisseur test",
      ref: "F-001",
    });

    expect(operationRef.startsWith("lfsci:")).toBe(true);
    const stored = server.records("res.partner").find((row) => row.id === id);
    expect(stored?.x_lfsci_ref).toBe(operationRef);
    expect(server.calls[0]?.kwargs.vals_list).toEqual([
      { name: "Fournisseur test", ref: "F-001", x_lfsci_ref: operationRef },
    ]);
  });

  it("finds a partner by its business reference, or nothing", async () => {
    const { server, client } = setup();
    server.seed("res.partner", [{ name: "Alpha", ref: "F-001" }]);
    const operations = createOdooOperations(client);
    expect((await operations.findPartnerByRef("F-001"))?.name).toBe("Alpha");
    expect(await operations.findPartnerByRef("F-404")).toBeNull();
  });

  it("refuses an ambiguous reference", async () => {
    const { server, client } = setup();
    server.seed("res.partner", [
      { name: "Alpha", ref: "F-001" },
      { name: "Alpha bis", ref: "F-001" },
    ]);
    const operations = createOdooOperations(client);
    const error = await caught(operations.findPartnerByRef("F-001"));
    expect(error.code).toBe("AMBIGUOUS_REFERENCE");
  });
});

describe("incremental reads", () => {
  it("paginates on (write_date, id) without duplicates", async () => {
    const { server, client } = setup();
    seedMoves(server, [
      { id: 1, write_date: "2026-01-01 10:00:00" },
      { id: 2, write_date: "2026-01-01 10:05:00" },
      { id: 3, write_date: "2026-01-01 10:05:00" },
      { id: 4, write_date: "2026-01-01 10:30:00" },
    ]);
    const operations = createOdooOperations(client);

    const page1 = await operations.readAccountMoves(undefined, undefined, { limit: 2 });
    expect(page1.records.map((row) => row.id)).toEqual([1, 2]);
    expect(page1.hasMore).toBe(true);

    const page2 = await operations.readAccountMoves(undefined, page1.nextCursor, { limit: 2 });
    expect(page2.records.map((row) => row.id)).toEqual([3, 4]);

    const page3 = await operations.readAccountMoves(undefined, page2.nextCursor, { limit: 2 });
    expect(page3.records).toEqual([]);
    expect(page3.hasMore).toBe(false);

    const seen = [...page1.records, ...page2.records, ...page3.records].map((row) => row.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("re-reads the ten minutes before the high-water mark when a pass starts", async () => {
    const { server, client } = setup();
    seedMoves(server, [
      { id: 1, write_date: "2026-01-01 10:00:00" },
      { id: 2, write_date: "2026-01-01 10:25:00" },
      { id: 3, write_date: "2026-01-01 10:30:00" },
    ]);
    const operations = createOdooOperations(client);
    const page = await operations.readAccountMoves("2026-01-01 10:30:00");

    expect(server.calls[0]?.kwargs.domain).toEqual([["write_date", ">=", "2026-01-01 10:20:00"]]);
    expect(page.records.map((row) => row.id)).toEqual([2, 3]);
  });

  it("reads journals and bank statement lines through search_read", async () => {
    const { server, client } = setup();
    server.seed("account.journal", [{ name: "Achats", code: "ACH", type: "purchase" }]);
    server.seed("account.bank.statement.line", [
      {
        id: 5,
        date: "2026-01-02",
        payment_ref: "VIR LOYER",
        amount: 750,
        partner_id: false,
        journal_id: [3, "Banque"],
        write_date: "2026-01-02 08:00:00",
      },
    ]);
    const operations = createOdooOperations(client);

    expect((await operations.readJournals({ types: ["purchase"] }))[0]?.code).toBe("ACH");
    const lines = await operations.readBankStatementLines("2026-01-02 08:00:00");
    expect(lines.records[0]?.amount).toBe(750);
  });
});

describe("writes", () => {
  it("creates a draft supplier bill with x2many line triples and the operation reference", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client);
    const { id, operationRef } = await operations.createDraftSupplierBill({
      partnerId: 7,
      invoiceDate: "2026-01-05",
      journalId: 2,
      lines: [{ name: "Entretien chaudière", priceUnit: 120, accountId: 601 }],
    });

    const stored = server.records("account.move").find((row) => row.id === id);
    expect(stored?.move_type).toBe("in_invoice");
    expect(stored?.x_lfsci_ref).toBe(operationRef);
    expect(stored?.invoice_line_ids).toEqual([
      [0, 0, { name: "Entretien chaudière", price_unit: 120, quantity: 1, account_id: 601 }],
    ]);
  });

  it("attaches a document as an ir.attachment with base64 datas", async () => {
    const { server, client, recorder } = setup();
    const operations = createOdooOperations(client);
    const { id } = await operations.attachDocument({
      name: "facture.pdf",
      base64: "JVBERi0xLjQK",
      resModel: "account.move",
      resId: 11,
      mimetype: "application/pdf",
    });
    const stored = server.records("ir.attachment").find((row) => row.id === id);
    expect(stored?.datas).toBe("JVBERi0xLjQK");
    expect(JSON.stringify(recorder.records)).not.toContain("JVBERi0xLjQK");
  });

  it("posts a move through action_post", async () => {
    const { server, client } = setup();
    server.handle("account.move", "action_post", () => true);
    const operations = createOdooOperations(client);
    await operations.postMove({ id: 11 });
    expect(server.calls[0]?.method).toBe("action_post");
    expect(server.calls[0]?.kwargs.ids).toEqual([11]);
  });

  it("refuses proposeReconciliation until Phase 0 supplies the real method", async () => {
    const { client } = setup();
    const operations = createOdooOperations(client);
    const error = await caught(
      operations.proposeReconciliation({ statementLineId: 5, moveLineIds: [9] }),
    );
    expect(error.code).toBe("RULE_VIOLATION");
  });
});

describe("unknown result reconciliation", () => {
  it("marks a lost response RESULT_UNKNOWN and resolves it later by operation reference", async () => {
    const { server, client } = setup({ timeoutMs: 25 });
    const operations = createOdooOperations(client);
    const operationRef = newOperationRef();

    server.dropNextResponse();
    const error = await caught(
      operations.createPartner({ name: "Fournisseur perdu", operationRef }),
    );
    expect(error.code).toBe("RESULT_UNKNOWN");

    expect(server.records("res.partner")).toHaveLength(1);
    const match = await operations.findByOperationRef(operationRef, { models: ["res.partner"] });
    expect(match).toEqual({ kind: "one", model: "res.partner", id: 1 });
  });

  it("reports none and many", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client);
    expect(
      await operations.findByOperationRef("lfsci:absent", { models: ["res.partner"] }),
    ).toEqual({ kind: "none" });

    server.seed("res.partner", [
      { name: "A", x_lfsci_ref: "lfsci:dup" },
      { name: "B", x_lfsci_ref: "lfsci:dup" },
    ]);
    const match = await operations.findByOperationRef("lfsci:dup", { models: ["res.partner"] });
    expect(match.kind).toBe("many");
  });
});

describe("capability gate on operations", () => {
  it("refuses a call the snapshot does not cover, before any HTTP request", async () => {
    const { server, client } = setup({ retry: noRetry });
    const snapshot: CapabilitySnapshot = {
      capturedAt: "2026-09-19T00:00:00.000Z",
      baseUrl: server.baseUrl,
      database: "lfsci-test",
      raw: "{}",
      parsed: {},
      models: { "res.partner": { methods: ["search_read"] } },
    };
    const operations = createOdooOperations(client, { capability: snapshot });
    const error = await caught(operations.createPartner({ name: "Refusé" }));
    expect(error.code).toBe("RULE_VIOLATION");
    expect(server.calls).toHaveLength(0);
  });
});

describe("configurable reference field", () => {
  it("writes the operation reference into the configured field", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client, { operationRefField: "x_studio_lfsci" });
    await runWithCorrelation({ requestId: "req-field" }, () =>
      operations.createPartner({ name: "Champ dédié", operationRef: "lfsci:abc" }),
    );
    expect(server.records("res.partner")[0]?.x_studio_lfsci).toBe("lfsci:abc");
  });
});
