import { describe, expect, it } from "vitest";
import {
  type BalanceSet,
  compareBalances,
  createCsvLedger,
  createOdooLedger,
  renderBalances,
} from "../src/balances";
import { SourceUnreachable } from "../src/model";
import { table } from "../src/report";
import { fakeOdoo, fixture } from "./helpers";

const app: BalanceSet = {
  asOf: "2026-06-30",
  source: "application",
  lines: [
    {
      entity: "SCI Exemple",
      odooCompanyId: 1,
      kind: "tenant",
      reference: "MARTIN Camille",
      odooPartnerId: 13,
      odooJournalId: null,
      amount: "780.00",
    },
    {
      entity: "SCI Exemple",
      odooCompanyId: 1,
      kind: "deposit",
      reference: "dépôts de garantie",
      odooPartnerId: null,
      odooJournalId: null,
      amount: "0.00",
    },
    {
      entity: "SCI Exemple",
      odooCompanyId: 1,
      kind: "loan",
      reference: "emprunts",
      odooPartnerId: null,
      odooJournalId: null,
      amount: "121430.55",
    },
    {
      entity: "SCI Exemple",
      odooCompanyId: 1,
      kind: "bank",
      reference: "Compte courant",
      odooPartnerId: null,
      odooJournalId: 13,
      amount: "15000.00",
    },
    {
      entity: "SCI Exemple",
      odooCompanyId: 1,
      kind: "nbv",
      reference: "valeur nette comptable",
      odooPartnerId: null,
      odooJournalId: null,
      amount: "250000.00",
    },
  ],
};

describe("opening balances", () => {
  it("reads the accountant's file, matches on names and lists every difference without correcting anything", async () => {
    const ledger = await createCsvLedger(fixture("balances.csv")).read("2026-06-30");
    const report = compareBalances("org", app, ledger);
    expect(report.lines).toEqual([
      expect.objectContaining({
        kind: "tenant",
        app: "780.00",
        ledger: "780.00",
        difference: "0.00",
        matchedOn: "name",
      }),
      expect.objectContaining({
        kind: "deposit",
        app: "0.00",
        ledger: "700.00",
        difference: "-700.00",
        matchedOn: "name",
      }),
      expect.objectContaining({ kind: "loan", difference: "0.00" }),
      expect.objectContaining({
        kind: "bank",
        reference: "Compte courant",
        app: "15000.00",
        ledger: null,
        difference: "15000.00",
        matchedOn: "none",
      }),
      expect.objectContaining({ kind: "nbv", difference: "0.00" }),
      expect.objectContaining({
        kind: "bank",
        reference: "Banque",
        app: null,
        ledger: "15250.10",
        difference: "-15250.10",
        matchedOn: "none",
      }),
    ]);
    expect(report).toMatchObject({ equal: 3, different: 3, blockers: [] });
    expect(renderBalances(report, table)).toContain("Rien n’a été corrigé");
  });

  it("aggregates posted move lines from Odoo by account family and matches on Odoo ids", async () => {
    const { server, client } = fakeOdoo();
    server.seed("account.account", [{ id: 900, code: "512000", name: "Bank" }]);
    server.records("account.journal").forEach((journal) => {
      if (journal.id === 13) journal.default_account_id = [900, "512000 Bank"];
    });
    server.seed("account.move.line", [
      {
        id: 1,
        balance: 780,
        account_id: [282, "411100 Customers"],
        partner_id: [13, "Camille Martin"],
        company_id: [1, "SCI Exemple"],
        journal_id: [8, "INV"],
        account_type: "asset_receivable",
        date: "2026-06-01",
        parent_state: "posted",
      },
      {
        id: 2,
        balance: -780,
        account_id: [624, "708300 Rentals"],
        partner_id: [13, "Camille Martin"],
        company_id: [1, "SCI Exemple"],
        journal_id: [8, "INV"],
        account_type: "income",
        date: "2026-06-01",
        parent_state: "posted",
      },
      {
        id: 3,
        balance: -700,
        account_id: [140, "165100 Deposits"],
        partner_id: [13, "Camille Martin"],
        company_id: [1, "SCI Exemple"],
        journal_id: [10, "MISC"],
        account_type: "liability_non_current",
        date: "2024-03-01",
        parent_state: "posted",
      },
      {
        id: 4,
        balance: 15200,
        account_id: [900, "512000 Bank"],
        partner_id: false,
        company_id: [1, "SCI Exemple"],
        journal_id: [13, "Bank"],
        account_type: "asset_cash",
        date: "2026-06-15",
        parent_state: "posted",
      },
      {
        id: 7,
        balance: -200,
        account_id: [900, "512000 Bank"],
        partner_id: false,
        company_id: [1, "SCI Exemple"],
        journal_id: [10, "MISC"],
        account_type: "asset_cash",
        date: "2026-06-16",
        parent_state: "posted",
      },
      {
        id: 5,
        balance: 500,
        account_id: [282, "411100 Customers"],
        partner_id: [13, "Camille Martin"],
        company_id: [1, "SCI Exemple"],
        journal_id: [8, "INV"],
        account_type: "asset_receivable",
        date: "2026-07-01",
        parent_state: "posted",
      },
      {
        id: 6,
        balance: 99,
        account_id: [282, "411100 Customers"],
        partner_id: [13, "Camille Martin"],
        company_id: [1, "SCI Exemple"],
        journal_id: [8, "INV"],
        account_type: "asset_receivable",
        date: "2026-06-02",
        parent_state: "draft",
      },
    ]);
    const ledger = await createOdooLedger(client).read("2026-06-30");
    expect(ledger.lines).toEqual([
      expect.objectContaining({ kind: "tenant", odooPartnerId: 13, amount: "780.00" }),
      expect.objectContaining({ kind: "deposit", amount: "700.00" }),
      expect.objectContaining({
        kind: "bank",
        reference: "Bank",
        odooJournalId: 13,
        amount: "15000.00",
      }),
    ]);
    const domain = server.calls.find((call) => call.model === "account.move.line")?.kwargs.domain;
    expect(domain).toEqual([
      ["parent_state", "=", "posted"],
      ["date", "<=", "2026-06-30"],
    ]);
    const report = compareBalances("org", app, ledger);
    expect(report.lines.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "tenant", difference: "0.00", matchedOn: "odoo_id" }),
      expect.objectContaining({ kind: "deposit", difference: "-700.00", matchedOn: "odoo_id" }),
    ]);
  });

  it("blocks the cut-over when the ledger extraction is empty, and cannot look when it is unreachable", async () => {
    const empty = compareBalances("org", app, {
      asOf: "2026-06-30",
      source: "export vide",
      lines: [],
    });
    expect(empty.blockers).toEqual([expect.stringContaining("aucun solde lu")]);
    await expect(createCsvLedger(fixture("absent.csv")).read("2026-06-30")).rejects.toBeInstanceOf(
      SourceUnreachable,
    );
  });
});
