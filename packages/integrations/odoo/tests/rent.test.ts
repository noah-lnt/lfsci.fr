import { isAppError } from "@lfsci/kernel";
import { createOdooOperations } from "@lfsci/odoo";
import { describe, expect, it } from "vitest";
import { setup } from "./helpers";

async function caught(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (value: unknown) => value,
  );
  if (!isAppError(error)) throw new Error(`expected an AppError, received ${String(error)}`);
  return error;
}

const rentTerm = {
  partnerId: 7,
  invoiceDate: "2026-09-05",
  accountingDate: "2026-09-05",
  rentAmount: "700.00",
  chargeAmount: "80.00",
  accessoryAmount: "0.00",
};

describe("lock dates", () => {
  it("reads the five company lock fields measured on Odoo 18", async () => {
    const { server, client } = setup();
    server.setLockDates({ fiscalyear_lock_date: "2026-06-30", hard_lock_date: "2025-12-31" });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    const locks = await operations.readLockDates();
    expect(locks).toEqual({
      companyId: 1,
      fiscalyear: "2026-06-30",
      tax: null,
      sale: null,
      purchase: null,
      hard: "2025-12-31",
      period: null,
    });
  });

  it("reads `1-01-01` and `false` alike as no lock at all", async () => {
    const { server, client } = setup();
    server.setLockDates({ sale_lock_date: "1-01-01" });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    expect((await operations.readLockDates()).sale).toBeNull();
    await expect(
      operations.assertPeriodOpen({ date: "2020-01-01", kind: "sale" }),
    ).resolves.toBeDefined();
  });

  it("refuses a date on or before the lock, and lets the next day through", async () => {
    const { server, client } = setup();
    server.setLockDates({ sale_lock_date: "2026-08-20" });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    const error = await caught(operations.assertPeriodOpen({ date: "2026-08-20", kind: "sale" }));
    expect(error.code).toBe("PERIOD_LOCKED");
    expect(error.details).toMatchObject({ locks: { sale: "2026-08-20" } });
    await expect(
      operations.assertPeriodOpen({ date: "2026-08-21", kind: "sale" }),
    ).resolves.toBeDefined();
  });

  it("applies the sale lock to an invoice and the purchase lock to a bill, hard lock to both", async () => {
    const { server, client } = setup();
    server.setLockDates({ sale_lock_date: "2026-08-20" });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    await expect(
      operations.assertPeriodOpen({ date: "2026-08-15", kind: "purchase" }),
    ).resolves.toBeDefined();
    expect(
      (await caught(operations.assertPeriodOpen({ date: "2026-08-15", kind: "sale" }))).code,
    ).toBe("PERIOD_LOCKED");

    server.setLockDates({ sale_lock_date: false, hard_lock_date: "2026-08-20" });
    for (const kind of ["sale", "purchase", "entry"] as const) {
      expect((await caught(operations.assertPeriodOpen({ date: "2026-08-15", kind }))).code).toBe(
        "PERIOD_LOCKED",
      );
    }
  });

  it("refuses a locked rent invoice before any write reaches Odoo", async () => {
    const { server, client } = setup();
    server.setLockDates({ hard_lock_date: "2026-09-30" });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    const error = await caught(operations.postRentInvoice(rentTerm));
    expect(error.code).toBe("PERIOD_LOCKED");
    expect(server.calls.map((call) => call.method)).toEqual(["search_read"]);
    expect(server.records("account.move")).toEqual([]);
  });
});

describe("rent invoice", () => {
  it("posts rent, charges and accessories as their own lines with the unit's analytic share", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    const move = await operations.postRentInvoice({
      ...rentTerm,
      accessoryAmount: "20.00",
      unit: { code: "LOT-A1", label: "Appartement A1" },
      ref: "BAIL-001 2026-09-01",
    });

    expect(move.name).toBe(`INV/${move.id}`);
    expect(move.accountingDate).toBe("2026-09-05");
    expect(move.amountTotal).toBe(800);

    const analytic = server.records("account.analytic.account")[0];
    expect(analytic).toMatchObject({ code: "LOT-A1", name: "Appartement A1", plan_id: 1 });
    expect(analytic?.x_lfsci_ref).toBeUndefined();

    const stored = server.records("account.move")[0];
    expect(stored?.x_lfsci_ref).toBe(move.operationRef);
    expect(stored?.ref).toBe("BAIL-001 2026-09-01");
    expect(stored?.invoice_line_ids).toEqual([
      [
        0,
        0,
        {
          name: "Loyer",
          price_unit: 700,
          quantity: 1,
          account_id: 624,
          analytic_distribution: { [String(analytic?.id)]: 100 },
        },
      ],
      [
        0,
        0,
        {
          name: "Provisions sur charges",
          price_unit: 80,
          quantity: 1,
          account_id: 620,
          analytic_distribution: { [String(analytic?.id)]: 100 },
        },
      ],
      [
        0,
        0,
        {
          name: "Accessoires",
          price_unit: 20,
          quantity: 1,
          account_id: 628,
          analytic_distribution: { [String(analytic?.id)]: 100 },
        },
      ],
    ]);
  });

  it("drops the empty parts and reuses the analytic account created on the first term", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    await operations.postRentInvoice({ ...rentTerm, unit: { code: "LOT-A1" } });
    await operations.postRentInvoice({
      ...rentTerm,
      invoiceDate: "2026-10-05",
      accountingDate: "2026-10-05",
      unit: { code: "LOT-A1" },
    });

    expect(server.records("account.analytic.account")).toHaveLength(1);
    const lines = server.records("account.move")[0]?.invoice_line_ids as unknown[][];
    expect(lines).toHaveLength(2);
  });

  it("takes the chart accounts from the options, not from a hard-coded chart", async () => {
    const { server, client } = setup();
    server.seed("account.account", [{ id: 900, code: "706100", name: "Loyers nus" }]);
    const operations = createOdooOperations(client, {
      lockCacheMs: 0,
      accounts: { rent: "706100" },
    });

    await operations.postRentInvoice({ ...rentTerm, chargeAmount: "0.00" });
    const lines = server.records("account.move")[0]?.invoice_line_ids as [
      number,
      number,
      Record<string, unknown>,
    ][];
    expect(lines[0]?.[2]?.account_id).toBe(900);
  });

  it("refuses a money value that is not a decimal string", async () => {
    const { client } = setup();
    const operations = createOdooOperations(client, { lockCacheMs: 0 });
    const error = await caught(operations.postRentInvoice({ ...rentTerm, rentAmount: "700.005" }));
    expect(error.code).toBe("VALIDATION");
  });

  it("refuses a missing chart account rather than posting without one", async () => {
    const { client } = setup();
    const operations = createOdooOperations(client, {
      lockCacheMs: 0,
      accounts: { rent: "999999" },
    });
    const error = await caught(operations.postRentInvoice(rentTerm));
    expect(error.code).toBe("NOT_FOUND");
    expect(error.details).toMatchObject({ code: "999999" });
  });

  it("catches the accounting date Odoo moved behind our back", async () => {
    const { server, client } = setup();
    // Odoo 18 answers a locked posting by shifting the date instead of refusing
    // (docs/odoo-poc.md step i): the pre-flight cannot see a lock set after it read.
    server.handle("account.move", "action_post", (kwargs, store) => {
      for (const move of store.get("account.move") ?? []) {
        if ((kwargs.ids as number[]).includes(move.id)) {
          move.state = "posted";
          move.date = "2026-09-30";
        }
      }
      return true;
    });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    const error = await caught(operations.postRentInvoice(rentTerm));
    expect(error.code).toBe("PERIOD_LOCKED");
    expect(error.details).toMatchObject({ requested: "2026-09-05", posted: "2026-09-30" });
  });
});

describe("partner current account entry", () => {
  it("credits 455 for a contribution and debits it for a repayment", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    await operations.postCcaEntry({
      kind: "contribution",
      amount: "1500.00",
      accountingDate: "2026-09-10",
      label: "Apport en compte courant",
      partnerId: 11,
    });
    const created = server.calls.find(
      (call) => call.model === "account.move" && call.method === "create",
    );
    const vals = (created?.kwargs.vals_list as Record<string, unknown>[] | undefined)?.[0];
    expect(vals?.journal_id).toBe(10);
    expect(vals?.move_type).toBe("entry");
    const contribution = server.records("account.move")[0];
    expect(contribution?.line_ids).toEqual([
      [
        0,
        0,
        {
          name: "Apport en compte courant",
          account_id: 300,
          debit: 0,
          credit: 1500,
          partner_id: 11,
        },
      ],
      [0, 0, { name: "Apport en compte courant", account_id: 330, debit: 1500, credit: 0 }],
    ]);

    await operations.postCcaEntry({
      kind: "repayment",
      amount: "500.00",
      accountingDate: "2026-09-11",
      label: "Remboursement",
    });
    const repayment = server.records("account.move")[1];
    expect(repayment?.line_ids).toEqual([
      [0, 0, { name: "Remboursement", account_id: 300, debit: 500, credit: 0 }],
      [0, 0, { name: "Remboursement", account_id: 330, debit: 0, credit: 500 }],
    ]);
  });

  it("follows the sign of a correction", async () => {
    const { server, client } = setup();
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    await operations.postCcaEntry({
      kind: "correction",
      amount: "-120.00",
      accountingDate: "2026-09-12",
      label: "Correction",
    });
    const lines = server.records("account.move")[0]?.line_ids as [
      number,
      number,
      Record<string, unknown>,
    ][];
    expect(lines[0]?.[2]).toMatchObject({ account_id: 300, debit: 120, credit: 0 });
  });

  it("refuses a locked entry before the write", async () => {
    const { server, client } = setup();
    server.setLockDates({ fiscalyear_lock_date: "2026-12-31" });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    const error = await caught(
      operations.postCcaEntry({
        kind: "contribution",
        amount: "10.00",
        accountingDate: "2026-09-12",
        label: "Apport",
      }),
    );
    expect(error.code).toBe("PERIOD_LOCKED");
    expect(server.records("account.move")).toEqual([]);
  });
});

describe("supplier bill", () => {
  it("dates the draft and refuses it when the purchase period is locked", async () => {
    const { server, client } = setup();
    server.setLockDates({ purchase_lock_date: "2026-09-30" });
    const operations = createOdooOperations(client, { lockCacheMs: 0 });

    const error = await caught(
      operations.createDraftSupplierBill({
        partnerId: 3,
        invoiceDate: "2026-09-05",
        lines: [{ name: "Entretien", priceUnit: 120 }],
      }),
    );
    expect(error.code).toBe("PERIOD_LOCKED");
    expect(server.records("account.move")).toEqual([]);
  });
});
