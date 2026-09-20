import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOdooCopyLedger } from "../src/balances";
import { SourceUnreachable } from "../src/model";
import { buildPlan } from "../src/plan";
import {
  COPY_ACCOUNTS,
  type CopyLine,
  createOdooCopySource,
  inferRoles,
  mapLines,
  netRentLines,
} from "../src/sources/odoo-copy";
import { existingRows } from "./helpers";

let nextId = 100;

function line(overrides: Partial<CopyLine> & { code: string }): CopyLine {
  const id = overrides.id ?? nextId++;
  return {
    id,
    move_id: 1000 + id,
    move_name: `BNK1/2026/${String(id).padStart(5, "0")}`,
    parent_state: "posted",
    date: "2026-03-05",
    debit: "0.00",
    credit: "0.00",
    partner_id: 21,
    partner_name: "Alex Locataire",
    statement_line_id: 5000 + id,
    company_id: 1,
    account_id: Number(overrides.code),
    account_type: overrides.code.startsWith("6") ? "expense" : "income",
    label: null,
    ...overrides,
  };
}

const rent = (over: Partial<CopyLine>) => line({ code: COPY_ACCOUNTS.rent, ...over });

describe("odoo copy — rents recognised on receipt", () => {
  it("nets a debit against the receipts of the same partner and month, in date order, one term per month", () => {
    const march1 = rent({ id: 1, date: "2026-03-02", credit: "700.00" });
    const march2 = rent({ id: 2, date: "2026-03-20", credit: "700.00" });
    const marchRefund = rent({ id: 3, date: "2026-03-25", debit: "100.00" });
    const april = rent({ id: 4, date: "2026-04-03", credit: "700.00" });
    const otherTenant = rent({ id: 5, date: "2026-03-10", credit: "500.00", partner_id: 22 });
    const { terms, leftover } = netRentLines([april, marchRefund, march2, otherTenant, march1]);
    // One term per tenant and month; the refund reduces the month's first receipt.
    expect(terms.map((t) => [t.credit.id, t.amount, t.netted.map((l) => l.id)])).toEqual([
      [1, "1300.00", [3]],
      [5, "500.00", []],
      [4, "700.00", []],
    ]);
    expect(terms[0]?.receipts.map((r) => [r.credit.id, r.amount])).toEqual([
      [1, "600.00"],
      [2, "700.00"],
    ]);
    expect(leftover).toEqual([]);
  });

  it("carries a debit across two receipts of the month and reports one it cannot absorb", () => {
    const { terms, leftover } = netRentLines([
      rent({ id: 1, date: "2026-05-01", credit: "300.00" }),
      rent({ id: 2, date: "2026-05-15", credit: "300.00" }),
      rent({ id: 3, date: "2026-05-16", debit: "400.00" }),
      rent({ id: 4, date: "2026-06-16", debit: "50.00" }),
    ]);
    expect(terms.map((t) => [t.credit.id, t.amount])).toEqual([[1, "200.00"]]);
    expect(terms[0]?.receipts.map((r) => [r.credit.id, r.amount])).toEqual([
      [1, "0.00"],
      [2, "200.00"],
    ]);
    expect(leftover.map((l) => l.id)).toEqual([4]);
  });

  it("maps a month with two receipts to one settled term with two receipts, and rejects the partner-less line", () => {
    const mapped = mapLines(
      [
        rent({ id: 1, date: "2026-03-02", credit: "700.00" }),
        rent({ id: 2, date: "2026-03-20", credit: "700.00" }),
        line({ id: 3, code: COPY_ACCOUNTS.charges, date: "2026-03-02", credit: "80.00" }),
        rent({ id: 4, date: "2026-03-09", credit: "650.00", partner_id: null }),
      ],
      "SCI Exemple",
      COPY_ACCOUNTS,
    );
    const terms = mapped.records.filter((r) => r.kind === "rent_term");
    expect(terms).toHaveLength(2);
    expect(terms[0]).toMatchObject({
      source: "odoo_copy",
      ref: "account.move.line:1",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      dueOn: "2026-03-02",
      total: "1400.00",
      residual: "0.00",
      settled: true,
      component: "rent",
      odooStatementLineId: 5001,
      nettedRefs: [],
    });
    // Two receipts in the month are two payments on the same term, never two terms.
    expect(terms[0]?.kind === "rent_term" ? terms[0].receipts : []).toEqual([
      expect.objectContaining({
        ref: "account.move.line:1",
        amount: "700.00",
        receivedOn: "2026-03-02",
      }),
      expect.objectContaining({
        ref: "account.move.line:2",
        amount: "700.00",
        receivedOn: "2026-03-20",
      }),
    ]);
    expect(terms[1]).toMatchObject({ component: "charges", total: "80.00" });
    expect(mapped.rejections).toEqual([
      expect.objectContaining({ ref: "account.move.line:4", reason: "missing_field" }),
    ]);
  });

  it("maps expenses, deposits, current-account and loan movements and derives the loan", () => {
    const mapped = mapLines(
      [
        line({ id: 1, code: "606100", date: "2026-01-10", debit: "120.50", partner_id: 31 }),
        line({ id: 2, code: "606100", date: "2026-01-11", debit: "10.00", partner_id: null }),
        line({ id: 3, code: "606100", date: "2026-01-12", credit: "5.00", partner_id: 31 }),
        line({ id: 4, code: "681120", date: "2026-12-31", debit: "900.00", partner_id: null }),
        line({ id: 5, code: COPY_ACCOUNTS.deposit, date: "2026-02-01", credit: "1400.00" }),
        line({
          id: 6,
          code: COPY_ACCOUNTS.cca,
          date: "2026-02-02",
          credit: "2000.00",
          partner_id: 41,
        }),
        line({
          id: 7,
          code: COPY_ACCOUNTS.cca,
          date: "2026-02-03",
          debit: "500.00",
          partner_id: 41,
        }),
        line({
          id: 8,
          code: COPY_ACCOUNTS.loan,
          date: "2025-01-01",
          credit: "50000.00",
          partner_id: 51,
        }),
        line({
          id: 9,
          code: COPY_ACCOUNTS.loan,
          date: "2025-02-01",
          debit: "400.00",
          partner_id: 51,
        }),
        line({
          id: 10,
          code: COPY_ACCOUNTS.loanInterest,
          date: "2025-02-01",
          debit: "60.00",
          partner_id: 51,
        }),
      ],
      "SCI Exemple",
      COPY_ACCOUNTS,
    );
    const kinds = mapped.records.map((r) => `${r.kind}:${r.ref}`);
    expect(kinds).toEqual([
      "expense:account.move.line:1",
      "deposit_movement:account.move.line:5",
      "cca_movement:account.move.line:6",
      "cca_movement:account.move.line:7",
      "loan_movement:account.move.line:8",
      "loan_movement:account.move.line:9",
      "loan_movement:account.move.line:10",
      "loan:account.move.line:8",
    ]);
    expect(mapped.records[0]).toMatchObject({ totalInclTax: "120.50", paid: true });
    expect(mapped.records[1]).toMatchObject({ direction: "received", amount: "1400.00" });
    expect(mapped.records[3]).toMatchObject({ direction: "repayment", amount: "500.00" });
    expect(mapped.records[6]).toMatchObject({ direction: "interest", amount: "60.00" });
    expect(mapped.records[7]).toMatchObject({
      principal: "50000.00",
      releasedOn: "2025-01-01",
      outstanding: "49600.00",
      outstandingOn: "2025-02-01",
      odooCompanyId: 1,
    });
    expect(mapped.rejections.map((r) => [r.ref, r.reason])).toEqual([
      ["account.move.line:2", "missing_field"],
      ["account.move.line:3", "unsupported"],
    ]);
  });

  it("infers roles from the accounts a partner appears on, several at once", () => {
    const lines = [
      rent({ partner_id: 21 }),
      line({ code: COPY_ACCOUNTS.cca, partner_id: 21 }),
      line({ code: "615200", partner_id: 21 }),
      line({ code: COPY_ACCOUNTS.loan, partner_id: 51 }),
      line({ code: "681120", partner_id: 61 }),
      line({ code: COPY_ACCOUNTS.bank, partner_id: 71, account_type: "asset_cash" }),
    ];
    expect(inferRoles(21, lines, COPY_ACCOUNTS)).toEqual(["associate", "supplier", "tenant"]);
    expect(inferRoles(51, lines, COPY_ACCOUNTS)).toEqual(["lender"]);
    expect(inferRoles(61, lines, COPY_ACCOUNTS)).toEqual([]);
    expect(inferRoles(71, lines, COPY_ACCOUNTS)).toEqual([]);
  });

  it("cannot look when the copy is unreachable", async () => {
    const error = await createOdooCopySource({ url: "postgres://x:x@127.0.0.1:9/x" })
      .read()
      .then(
        () => null,
        (value: unknown) => value,
      );
    expect(error).toBeInstanceOf(SourceUnreachable);
    expect((error as SourceUnreachable).source).toBe("odoo_copy");
    expect((error as Error).message).toContain("Copie Odoo");
  });
});

const TEST_URL = process.env.TEST_DATABASE_URL;
const COPY_DB = "lfsci_test_odoo_copy";

function copyUrl(): string {
  const url = new URL(TEST_URL ?? "postgres://127.0.0.1/x");
  url.pathname = `/${COPY_DB}`;
  return url.toString();
}

async function withMaintenance(work: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const url = new URL(TEST_URL ?? "");
  url.pathname = "/postgres";
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await work(sql);
  } finally {
    await sql.end();
  }
}

/** Only the columns the reader touches, shaped as Odoo 19 stores them. */
const SCHEMA = `
  CREATE TABLE res_company (id int PRIMARY KEY, name varchar, partner_id int,
    fiscalyear_lock_date date, hard_lock_date date);
  CREATE TABLE res_partner (id int PRIMARY KEY, name varchar, email varchar, phone varchar,
    vat varchar, active boolean);
  CREATE TABLE account_account (id int PRIMARY KEY, account_type varchar, name jsonb, code_store jsonb);
  CREATE TABLE account_journal (id int PRIMARY KEY, type varchar, code varchar, name jsonb,
    default_account_id int);
  CREATE TABLE account_move (id int PRIMARY KEY, name varchar, state varchar, date date);
  CREATE TABLE account_move_line (id int PRIMARY KEY, move_id int, parent_state varchar, date date,
    debit numeric, credit numeric, balance numeric, partner_id int, statement_line_id int,
    company_id int, account_id int, name varchar);
  CREATE TABLE account_bank_statement_line (id int PRIMARY KEY, move_id int, amount numeric,
    payment_ref varchar, journal_id int, company_id int, is_reconciled boolean, partner_id int);
  CREATE TABLE account_asset (id int PRIMARY KEY, name varchar, state varchar, original_value numeric,
    book_value numeric, acquisition_date date, company_id int);
`;

const SEED = `
  INSERT INTO res_company VALUES (1, 'SCI Exemple', 1, '2025-12-31', NULL);
  INSERT INTO res_partner VALUES
    (1, 'SCI Exemple', NULL, NULL, 'FR00000000000', true),
    (21, 'Alex Locataire', 'alex@example.test', NULL, NULL, true),
    (22, 'Sam Ancien', NULL, NULL, NULL, false),
    (31, 'Chauffage Exemple SAS', NULL, NULL, 'FR11111111111', true),
    (41, 'Dominique Associe', NULL, '0600000000', NULL, true),
    (51, 'Banque Exemple', NULL, NULL, NULL, true),
    (99, 'Contact sans role', NULL, NULL, NULL, true);
  INSERT INTO account_account VALUES
    (701, 'income', '{"en_US": "Rents received", "fr_FR": "Loyers encaissés"}', '{"1": "706003"}'),
    (702, 'liability_current', '{"en_US": "Charge provisions"}', '{"1": "706004"}'),
    (601, 'expense', '{"en_US": "Maintenance"}', '{"1": "615200"}'),
    (681, 'expense', '{"en_US": "Depreciation"}', '{"1": "681120"}'),
    (165, 'liability_current', '{"en_US": "Deposits"}', '{"1": "165500"}'),
    (455, 'liability_current', '{"en_US": "Partners"}', '{"1": "455100"}'),
    (164, 'liability_current', '{"en_US": "Loan"}', '{"1": "164000"}'),
    (661, 'expense', '{"en_US": "Interest"}', '{"1": "661600"}'),
    (512, 'asset_cash', '{"en_US": "Bank"}', '{"1": "512001"}'),
    (513, 'asset_current', '{"en_US": "Suspense"}', '{"1": "512002"}'),
    (213, 'asset_fixed', '{"en_US": "Buildings"}', '{"1": "213100"}'),
    (281, 'asset_fixed', '{"en_US": "Buildings depreciation"}', '{"1": "281300"}');
  INSERT INTO account_journal VALUES (15, 'bank', 'BNK1', '{"en_US": "Bank Exemple"}', 512);
  INSERT INTO account_move VALUES
    (1, 'BNK1/2026/00001', 'posted', '2026-03-02'),
    (2, 'BNK1/2026/00002', 'posted', '2026-03-20'),
    (3, 'BNK1/2026/00003', 'posted', '2026-03-25'),
    (4, 'BNK1/2026/00004', 'posted', '2026-03-12'),
    (5, 'BNK1/2026/00005', 'posted', '2026-02-01'),
    (6, 'BNK1/2026/00006', 'posted', '2026-02-02'),
    (7, 'BNK1/2025/00001', 'posted', '2025-01-01'),
    (8, 'BNK1/2025/00002', 'posted', '2025-02-01'),
    (9, 'MISC/2025/00001', 'posted', '2025-12-31'),
    (10, 'BNK1/2026/00007', 'draft', '2026-04-01'),
    (11, 'BNK1/2026/00008', 'posted', '2026-03-30');
  INSERT INTO account_move_line VALUES
    (1, 1, 'posted', '2026-03-02', 0, 700, -700, 21, 1, 1, 701, 'rent'),
    (2, 1, 'posted', '2026-03-02', 700, 0, 700, 21, 1, 1, 512, 'rent'),
    (3, 2, 'posted', '2026-03-20', 0, 700, -700, 21, 2, 1, 701, 'rent again'),
    (4, 2, 'posted', '2026-03-20', 700, 0, 700, 21, 2, 1, 512, 'rent again'),
    (5, 3, 'posted', '2026-03-25', 100, 0, 100, 21, 3, 1, 701, 'refund'),
    (6, 3, 'posted', '2026-03-25', 0, 100, -100, 21, 3, 1, 512, 'refund'),
    (7, 4, 'posted', '2026-03-12', 240.5, 0, 240.5, 31, 4, 1, 601, 'boiler'),
    (8, 4, 'posted', '2026-03-12', 0, 240.5, -240.5, 31, 4, 1, 512, 'boiler'),
    (9, 5, 'posted', '2026-02-01', 0, 1400, -1400, 21, 5, 1, 165, 'deposit'),
    (10, 5, 'posted', '2026-02-01', 1400, 0, 1400, 21, 5, 1, 512, 'deposit'),
    (11, 6, 'posted', '2026-02-02', 0, 2000, -2000, 41, 6, 1, 455, 'contribution'),
    (12, 6, 'posted', '2026-02-02', 2000, 0, 2000, 41, 6, 1, 512, 'contribution'),
    (13, 7, 'posted', '2025-01-01', 0, 50000, -50000, 51, 7, 1, 164, 'loan'),
    (14, 7, 'posted', '2025-01-01', 50000, 0, 50000, 51, 7, 1, 512, 'loan'),
    (15, 8, 'posted', '2025-02-01', 400, 0, 400, 51, 8, 1, 164, 'instalment'),
    (16, 8, 'posted', '2025-02-01', 60, 0, 60, 51, 8, 1, 661, 'instalment'),
    (17, 8, 'posted', '2025-02-01', 0, 460, -460, 51, 8, 1, 512, 'instalment'),
    (18, 9, 'posted', '2025-12-31', 900, 0, 900, NULL, NULL, 1, 681, 'depreciation'),
    (19, 9, 'posted', '2025-12-31', 0, 900, -900, NULL, NULL, 1, 281, 'depreciation'),
    (20, 10, 'draft', '2026-04-01', 0, 700, -700, 21, 10, 1, 701, 'draft rent'),
    (21, 11, 'posted', '2026-03-30', 0, 80, -80, 21, 11, 1, 702, 'charges'),
    (22, 11, 'posted', '2026-03-30', 80, 0, 80, 21, 11, 1, 512, 'charges');
  INSERT INTO account_bank_statement_line VALUES
    (1, 1, 700, 'VIR LOYER MARS', 15, 1, true, 21),
    (2, 2, 700, 'VIR LOYER MARS BIS', 15, 1, true, 21),
    (3, 3, -100, 'VIR REMBOURSEMENT', 15, 1, true, 21),
    (4, 4, -240.5, 'PRLV CHAUFFAGE', 15, 1, true, 31),
    (5, 5, 1400, 'VIR DEPOT', 15, 1, true, 21),
    (6, 6, 2000, 'VIR APPORT', 15, 1, true, 41),
    (7, 7, 50000, 'DEBLOCAGE PRET', 15, 1, true, 51),
    (8, 8, -460, 'ECHEANCE PRET', 15, 1, true, 51),
    (11, 11, 80, 'VIR CHARGES', 15, 1, false, 21);
  INSERT INTO account_asset VALUES
    (1, 'Modele', 'model', 0, 0, NULL, 1),
    (2, 'Immeuble Exemple', 'open', 180000, 171000, '2025-01-01', 1),
    (3, 'Annule', 'cancelled', 10, 10, '2025-01-01', 1);
`;

describe.skipIf(!TEST_URL)("odoo copy — against a throwaway Odoo 19-shaped database", () => {
  beforeAll(async () => {
    await withMaintenance(async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${COPY_DB}`);
      await sql.unsafe(`CREATE DATABASE ${COPY_DB}`);
    });
    const sql = postgres(copyUrl(), { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(SCHEMA);
      await sql.unsafe(SEED);
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    await withMaintenance(async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${COPY_DB}`);
    });
  });

  it("reads the jsonb code and names, infers persons and suppliers, nets the rents and links the statement lines", async () => {
    const read = await createOdooCopySource({
      url: copyUrl(),
      now: () => new Date("2026-09-20T08:00:00Z"),
    }).read();
    expect(read.source).toBe("odoo_copy");
    expect(read.found).toBe(7 + 21 + 9 + 1);
    expect(read.coverage).toEqual({ from: "2025-01-01", to: "2026-03-30" });
    expect(read.notes[0]).toContain("exercice verrouillé au 2025-12-31");
    expect(read.notes[0]).toContain("verrou définitif aucun");

    const persons = read.records.filter((r) => r.kind === "person");
    expect(persons.map((p) => [p.ref, p.roles, p.email])).toEqual([
      ["res.partner:21", ["tenant"], "alex@example.test"],
      ["res.partner:41", ["associate"], null],
      ["res.partner:51", ["lender"], null],
    ]);
    expect(read.records.filter((r) => r.kind === "supplier").map((r) => r.ref)).toEqual([
      "res.partner:31",
    ]);

    const terms = read.records.filter((r) => r.kind === "rent_term");
    expect(
      terms.map((t) => [t.ref, t.total, t.component, t.odooStatementLineId, t.nettedRefs]),
    ).toEqual([
      ["account.move.line:1", "1300.00", "rent", 1, ["account.move.line:5"]],
      ["account.move.line:21", "80.00", "charges", 11, []],
    ]);
    expect(
      terms[0]?.kind === "rent_term" ? terms[0].receipts.map((r) => [r.ref, r.amount]) : [],
    ).toEqual([
      ["account.move.line:1", "600.00"],
      ["account.move.line:3", "700.00"],
    ]);
    expect(terms[0]).toMatchObject({
      entity: "SCI Exemple",
      odooCompanyId: 1,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      settled: true,
      odooMoveName: "BNK1/2026/00001",
    });
    expect(read.records.filter((r) => r.kind === "expense")).toEqual([
      expect.objectContaining({ ref: "account.move.line:7", totalInclTax: "240.50" }),
    ]);
    expect(read.records.filter((r) => r.kind === "bank_line")).toHaveLength(9);
    expect(read.records.filter((r) => r.kind === "bank_line")[0]).toMatchObject({
      journal: "Bank Exemple",
      odooJournalId: 15,
      date: "2025-01-01",
      amount: "50000.00",
    });
    expect(read.records.filter((r) => r.kind === "asset")).toEqual([
      expect.objectContaining({
        ref: "account.asset:2",
        grossValue: "180000.00",
        accumulatedDepreciation: "9000.00",
        netBookValue: "171000.00",
        commissionedOn: "2025-01-01",
      }),
    ]);
    expect(read.records.filter((r) => r.kind === "loan")).toEqual([
      expect.objectContaining({
        principal: "50000.00",
        outstanding: "49600.00",
        lender: "Banque Exemple",
      }),
    ]);
    expect(read.rejections).toEqual([]);

    const plan = buildPlan({ organizationId: "org", reads: [read], existing: existingRows() });
    expect(plan.proposals).toEqual([
      expect.objectContaining({ kind: "lease", ref: "res.partner:21" }),
    ]);
    expect(plan.records.filter((r) => r.kind === "lease")).toEqual([
      expect.objectContaining({
        reference: "BAIL-ODOO-21",
        inferred: true,
        startsOn: "2026-03-01",
        rent: "1300.00",
        charges: "80.00",
        deposit: "1400.00",
      }),
    ]);
    expect(Object.values(plan.resolutions.rentTermLeases)).toEqual([
      { create: "lease:BAIL-ODOO-21" },
      { create: "lease:BAIL-ODOO-21" },
    ]);
    expect(plan.deferrals.map((d) => d.reason)).toEqual([
      ...Array<string>(5).fill("entered_in_app"),
      ...Array<string>(9).fill("owned_by_backsync"),
    ]);
    expect(plan.blockers).toEqual([]);
  });

  it("sums the ledger per account family at a date, liabilities read as what is owed", async () => {
    const ledger = await createOdooCopyLedger(copyUrl()).read("2026-03-31");
    const byKind = Object.fromEntries(
      ledger.lines.map((l) => [`${l.kind}:${l.reference}`, l.amount]),
    );
    expect(byKind).toEqual({
      "deposit:dépôts de garantie": "1400.00",
      "cca:Dominique Associe": "2000.00",
      "loan:emprunts": "49600.00",
      "nbv:valeur nette comptable": "-900.00",
      "bank:Bank Exemple": "54079.50",
    });
    expect(ledger.lines.find((l) => l.kind === "bank")).toMatchObject({
      odooCompanyId: 1,
      odooJournalId: 15,
    });
    const earlier = await createOdooCopyLedger(copyUrl()).read("2025-01-31");
    expect(earlier.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["loan", "50000.00"],
      ["bank", "50000.00"],
    ]);
  });
});
