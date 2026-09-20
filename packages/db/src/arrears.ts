import { sql } from "drizzle-orm";
import type { Tx } from "./client";

/**
 * LOY-04 read side, shared by the worker's `arrears.detect` and the recouvrement
 * screen so the two can never disagree on what is due. The rules that qualify
 * and grade an arrear live in `@lfsci/domain`; only the SQL lives here.
 */

export const ARREARS_TERM_LIMIT = 500;
export const LEDGER_CONNECTOR = "odoo";

export type OverdueTermRow = {
  rent_term_id: string;
  lease_id: string;
  lease_version: number;
  lease_reference: string;
  lease_status: string;
  currency: string;
  term_status: string;
  period_start: string;
  period_end: string;
  due_on: string;
  total_amount: string | null;
  allocated: string;
  pending_allocated: string;
  person_id: string | null;
  display_name: string | null;
  contact_point_id: string | null;
  contact_value: string | null;
};

async function rows<T extends Record<string, unknown>>(
  tx: Tx,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return [...(await tx.execute<T>(query))] as T[];
}

/** Terms due before `asOf` and not settled, with the billing tenant and their active e-mail. Imported history is excluded (TMP-04). */
export async function overdueTerms(tx: Tx, asOf: string): Promise<OverdueTermRow[]> {
  return rows<OverdueTermRow>(
    tx,
    sql`SELECT t.id AS rent_term_id, t.lease_id, l.version AS lease_version,
               l.reference AS lease_reference, l.status AS lease_status,
               COALESCE(v.currency, l.currency) AS currency, t.status AS term_status,
               to_char(t.period_start, 'YYYY-MM-DD') AS period_start,
               to_char(t.period_end, 'YYYY-MM-DD') AS period_end,
               to_char(t.due_on, 'YYYY-MM-DD') AS due_on,
               v.total_amount,
               COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                          WHERE a.rent_term_id = t.id AND a.reversed_at IS NULL), 0)::text
                 AS allocated,
               COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                          WHERE a.rent_term_id = t.id AND a.reversed_at IS NULL
                            AND a.confirmed_by_odoo = false), 0)::text AS pending_allocated,
               tenant.person_id, tenant.display_name,
               tenant.contact_point_id, tenant.contact_value
          FROM rent_term t
          JOIN lease l ON l.id = t.lease_id
          LEFT JOIN rent_term_version v ON v.id = t.current_version_id
          LEFT JOIN LATERAL (
                 SELECT p.id AS person_id, p.display_name,
                        c.id AS contact_point_id, c.value AS contact_value
                   FROM lease_party lp
                   JOIN person p ON p.id = lp.person_id
                   LEFT JOIN LATERAL (
                          SELECT cp.id, cp.value FROM contact_point cp
                           WHERE cp.person_id = p.id AND cp.kind = 'email'
                             AND cp.status = 'active'
                           ORDER BY cp.is_primary DESC, cp.created_at
                           LIMIT 1
                        ) c ON TRUE
                  WHERE lp.lease_id = l.id AND lp.role IN ('holder', 'co_holder')
                    AND (lp.ends_on IS NULL OR lp.ends_on >= ${asOf}::date)
                  ORDER BY lp.is_billing_contact DESC, lp.role, lp.starts_on
                  LIMIT 1
               ) tenant ON TRUE
         WHERE t.due_on < ${asOf}::date
           AND t.status NOT IN ('settled', 'cancelled')
           AND t.is_migration_import = false
         ORDER BY t.due_on, t.id
         LIMIT ${ARREARS_TERM_LIMIT}`,
  );
}

/** LOY-02: a sum received but not allocated is a credit to qualify, not a settled term. */
export async function unappliedCreditByLease(tx: Tx): Promise<Map<string, string>> {
  const found = await rows<{ lease_id: string; unapplied: string }>(
    tx,
    sql`SELECT lp.lease_id,
               sum(GREATEST(p.amount - COALESCE(alloc.total, 0), 0))::text AS unapplied
          FROM payment p
          JOIN lease_party lp ON lp.person_id = p.payer_person_id
          LEFT JOIN LATERAL (
                 SELECT sum(a.amount) AS total FROM payment_allocation a
                  WHERE a.payment_id = p.id AND a.reversed_at IS NULL
               ) alloc ON TRUE
         WHERE p.direction = 'inbound'
           AND p.status IN ('to_qualify', 'partially_allocated', 'overpaid')
         GROUP BY lp.lease_id`,
  );
  return new Map(found.map((row) => [row.lease_id, row.unapplied]));
}

export type LedgerFreshness = { healthy: boolean; lastSuccessOn: string | null };

/** No cursor at all means the ledger is not wired yet, which is not a sync incident. */
export async function ledgerFreshness(tx: Tx): Promise<LedgerFreshness> {
  const found = await rows<{ health: string; success_on: string | null }>(
    tx,
    sql`SELECT health,
               to_char(last_success_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS success_on
          FROM integration_cursor
         WHERE connector = ${LEDGER_CONNECTOR}
         ORDER BY last_success_at DESC NULLS LAST
         LIMIT 1`,
  );
  const row = found[0];
  if (!row) return { healthy: true, lastSuccessOn: null };
  return {
    healthy: row.health === "healthy" || row.health === "degraded",
    lastSuccessOn: row.success_on,
  };
}
