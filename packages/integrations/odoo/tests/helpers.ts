import type { OdooClientConfig } from "@lfsci/odoo";
import { createMemoryRecorder, createOdooClient } from "@lfsci/odoo";
import { createFakeOdoo, createManualClock } from "@lfsci/odoo/testing";

export function setup(overrides: Partial<OdooClientConfig> = {}) {
  const clock = createManualClock();
  const server = createFakeOdoo({ now: () => clock.now() });
  const recorder = createMemoryRecorder();
  const client = createOdooClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    database: "lfsci-test",
    fetch: server.fetch,
    clock,
    recorder,
    random: () => 0.5,
    ...overrides,
  });
  return { clock, server, recorder, client };
}

export const noRetry = { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 };

export function seedMoves(
  server: ReturnType<typeof createFakeOdoo>,
  rows: { id: number; write_date: string; amount?: number }[],
) {
  server.seed(
    "account.move",
    rows.map((row) => ({
      id: row.id,
      name: `BILL/${row.id}`,
      ref: false,
      state: "draft",
      move_type: "in_invoice",
      date: "2026-01-01",
      amount_total: row.amount ?? 100,
      amount_residual: row.amount ?? 100,
      currency_id: [1, "EUR"],
      partner_id: [7, "Fournisseur test"],
      journal_id: [2, "Achats"],
      write_date: row.write_date,
    })),
  );
}
