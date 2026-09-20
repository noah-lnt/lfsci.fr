import { join } from "node:path";
import { createOdooClient } from "@lfsci/odoo";
import { createFakeOdoo, createManualClock } from "@lfsci/odoo/testing";
import { migrateDir } from "../src/cli";
import type { ExistingRows } from "../src/model";

export const fixture = (name: string) => join(migrateDir, "..", "fixtures", name);

export const ENTITY_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const EXISTING_PERSON_ID = "22222222-2222-4222-8222-222222222222";

export function existingRows(overrides: Partial<ExistingRows> = {}): ExistingRows {
  return {
    entities: [{ id: ENTITY_ID, name: "SCI Exemple", odooCompanyId: 1 }],
    persons: [],
    suppliers: [],
    leases: [],
    buildings: [
      { id: "77777777-7777-4777-8777-777777777777", code: "IMM-01", legalEntityId: ENTITY_ID },
    ],
    ...overrides,
  };
}

export function fakeOdoo() {
  const clock = createManualClock();
  const server = createFakeOdoo({ now: () => clock.now() });
  const client = createOdooClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    database: server.database,
    login: server.login,
    transport: "jsonrpc",
    fetch: server.fetch,
    clock,
    random: () => 0.5,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  return { server, client, clock };
}

export function seedLedger(server: ReturnType<typeof fakeOdoo>["server"]) {
  server.seed("res.partner", [
    {
      id: 13,
      name: "Camille Martin",
      ref: "LFSCI-TENANT-0001",
      email: "camille.martin@example.test",
      is_company: false,
      customer_rank: 3,
      supplier_rank: 0,
    },
    {
      id: 14,
      name: "Plombier Dupuis SARL",
      ref: false,
      email: false,
      vat: "FR12345678901",
      is_company: true,
      customer_rank: 0,
      supplier_rank: 2,
    },
    {
      id: 15,
      name: "Jean Dupont",
      ref: false,
      email: false,
      is_company: false,
      customer_rank: 1,
      supplier_rank: 0,
    },
    {
      id: 3,
      name: "Administrator",
      ref: false,
      email: "admin@example.com",
      is_company: false,
      customer_rank: 0,
      supplier_rank: 0,
    },
  ]);
  server.seed("account.move", [
    {
      id: 55,
      name: "INV/2026/00023",
      move_type: "out_invoice",
      state: "posted",
      date: "2026-07-01",
      invoice_date_due: "2026-07-05",
      amount_total: 780,
      amount_residual: 0,
      payment_state: "paid",
      partner_id: [13, "Camille Martin"],
      company_id: [1, "SCI Exemple"],
    },
    {
      id: 58,
      name: "INV/2026/00024",
      move_type: "out_invoice",
      state: "posted",
      date: "2026-08-01",
      invoice_date_due: "2026-08-05",
      amount_total: 780,
      amount_residual: 400,
      payment_state: "partial",
      partner_id: [13, "Camille Martin"],
      company_id: [1, "SCI Exemple"],
    },
    {
      id: 60,
      name: false,
      move_type: "out_invoice",
      state: "draft",
      date: "2026-09-01",
      invoice_date_due: false,
      amount_total: 780,
      amount_residual: 780,
      payment_state: "not_paid",
      partner_id: [13, "Camille Martin"],
      company_id: [1, "SCI Exemple"],
    },
    {
      id: 61,
      name: "INV/2026/00025",
      move_type: "out_invoice",
      state: "posted",
      date: "2026-08-01",
      invoice_date_due: "2026-08-05",
      amount_total: 600,
      amount_residual: 0,
      payment_state: "paid",
      partner_id: [15, "Jean Dupont"],
      company_id: [1, "SCI Exemple"],
    },
    {
      id: 70,
      name: "BILL/2026/00003",
      move_type: "in_invoice",
      state: "posted",
      date: "2026-06-12",
      invoice_date_due: "2026-07-12",
      amount_total: 312.5,
      amount_residual: 0,
      payment_state: "paid",
      partner_id: [14, "Plombier Dupuis SARL"],
      company_id: [1, "SCI Exemple"],
    },
    {
      id: 71,
      name: "BILL/2026/00004",
      move_type: "in_invoice",
      state: "posted",
      date: "2026-06-13",
      invoice_date_due: "2026-07-13",
      amount_total: 100,
      amount_residual: 100,
      payment_state: "not_paid",
      partner_id: false,
      company_id: [1, "SCI Exemple"],
    },
  ]);
  server.seed("account.bank.statement.line", [
    {
      id: 1,
      date: "2026-07-03",
      payment_ref: "VIR MARTIN LOYER",
      amount: 780,
      partner_id: [13, "Camille Martin"],
      journal_id: [13, "Bank"],
      write_date: "2026-07-03 10:00:00",
    },
  ]);
}
