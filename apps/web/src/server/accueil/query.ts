import "server-only";
import type { Tx } from "@lfsci/db";
import { certificateState } from "@lfsci/domain";
import { sql } from "drizzle-orm";
import type { AmountIndicator, OccupancyIndicator, SituationResult } from "@/lib/contracts/accueil";
import { tenant } from "../data";
import { modelStatus } from "../rpc/modules/health";
import { buildBanner } from "./banner";
import type {
  CardSource,
  CommandExceptionRow,
  DeadlineCardRow,
  InboxCardRow,
  InsuranceExceptionRow,
  LateRentTermRow,
  MissingDocumentRow,
  PendingApprovalRow,
} from "./cards";
import type { TenantScope } from "./scope";

const MAX_ROWS = 200;

/** object_ref keeps one nullable column per kind; exactly one is set. */
const OBJECT_ID = sql`COALESCE(o.legal_entity_id, o.building_id, o.unit_id, o.person_id, o.lease_id,
  o.rent_term_id, o.payment_id, o.deposit_account_id, o.expense_id, o.works_project_id,
  o.intervention_id, o.equipment_id, o.meter_id, o.loan_id, o.partner_current_account_id,
  o.fixed_asset_id, o.insurance_policy_id, o.claim_id, o.booking_id, o.listing_id,
  o.inspection_id, o.supplier_id, o.bank_account_id, o.document_id)`;

async function rows<T extends Record<string, unknown>>(
  tx: Tx,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return [...(await tx.execute<T>(query))] as T[];
}

async function today(tx: Tx): Promise<string> {
  const result = await rows<{ day: string }>(
    tx,
    sql`SELECT to_char((now() AT TIME ZONE 'Europe/Paris')::date, 'YYYY-MM-DD') AS day`,
  );
  return result[0]?.day ?? new Date().toISOString().slice(0, 10);
}

async function lateRentTerms(tx: Tx): Promise<LateRentTermRow[]> {
  const found = await rows<{
    rent_term_id: string;
    lease_id: string;
    lease_reference: string | null;
    due_on: string;
    total_amount: string | null;
    currency: string;
    allocated: string;
  }>(
    tx,
    sql`SELECT t.id AS rent_term_id, t.lease_id, l.reference AS lease_reference,
               to_char(t.due_on, 'YYYY-MM-DD') AS due_on,
               v.total_amount, COALESCE(v.currency, 'EUR') AS currency,
               COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                          WHERE a.rent_term_id = t.id AND a.reversed_at IS NULL), 0)::text AS allocated
          FROM rent_term t
          JOIN lease l ON l.id = t.lease_id
          LEFT JOIN rent_term_version v ON v.id = t.current_version_id
         WHERE t.due_on < (now() AT TIME ZONE 'Europe/Paris')::date
           AND t.status NOT IN ('settled', 'cancelled')
         ORDER BY t.due_on
         LIMIT ${MAX_ROWS}`,
  );
  return found
    .filter((row) => row.total_amount !== null)
    .map((row) => ({
      rentTermId: row.rent_term_id,
      leaseId: row.lease_id,
      leaseReference: row.lease_reference,
      dueOn: row.due_on,
      totalAmount: row.total_amount ?? "0",
      allocatedAmount: row.allocated,
      currency: row.currency,
    }))
    .filter((row) => Number(row.totalAmount) - Number(row.allocatedAmount) > 0.004);
}

async function commandExceptions(tx: Tx): Promise<CommandExceptionRow[]> {
  const found = await rows<{
    id: string;
    command_type: string;
    status: CommandExceptionRow["status"];
    error_detail: string | null;
    occurred_at: string;
  }>(
    tx,
    sql`SELECT id, command_type, status, error_detail,
               to_char(COALESCE(updated_at, created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS occurred_at
          FROM command
         WHERE status IN ('unknown_result', 'conflict', 'rejected')
         ORDER BY COALESCE(updated_at, created_at)
         LIMIT ${MAX_ROWS}`,
  );
  return found.map((row) => ({
    commandId: row.id,
    commandType: row.command_type,
    status: row.status,
    errorDetail: row.error_detail,
    occurredAt: row.occurred_at,
  }));
}

/** A `prepared` C/D command with no live approval for its current hash is waiting on the owner. */
async function pendingApprovals(tx: Tx): Promise<PendingApprovalRow[]> {
  const found = await rows<{
    id: string;
    command_type: string;
    autonomy_level: PendingApprovalRow["level"];
    created_at: string;
  }>(
    tx,
    sql`SELECT c.id, c.command_type, c.autonomy_level,
               to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_at
          FROM command c
         WHERE c.status = 'prepared'
           AND c.autonomy_level IN ('C', 'D')
           AND NOT EXISTS (
                 SELECT 1 FROM approval a
                  WHERE a.command_id = c.id
                    AND a.decision = 'approved'
                    AND a.revoked_at IS NULL
                    AND a.expires_at > now()
                    AND a.approved_payload_hash = c.payload_hash)
         ORDER BY c.created_at
         LIMIT ${MAX_ROWS}`,
  );
  return found.map((row) => ({
    commandId: row.id,
    commandType: row.command_type,
    level: row.autonomy_level,
    occurredAt: row.created_at,
  }));
}

async function dueDeadlines(tx: Tx): Promise<DeadlineCardRow[]> {
  const found = await rows<{
    id: string;
    title: string;
    type: string;
    due_on: string;
    priority: DeadlineCardRow["priority"];
    objects: { kind: string; id: string }[] | null;
  }>(
    tx,
    sql`SELECT d.id, d.title, d.type, to_char(d.due_on, 'YYYY-MM-DD') AS due_on, d.priority,
               (SELECT json_agg(json_build_object('kind', o.kind, 'id', ${OBJECT_ID}))
                  FROM deadline_link dl
                  JOIN object_ref o ON o.id = dl.object_ref_id
                 WHERE dl.deadline_id = d.id) AS objects
          FROM deadline d
         WHERE d.status IN ('planned', 'to_process', 'postponed', 'blocked')
           AND d.due_on <= (now() AT TIME ZONE 'Europe/Paris')::date + 7
         ORDER BY d.due_on
         LIMIT ${MAX_ROWS}`,
  );
  return found.map((row) => ({
    deadlineId: row.id,
    title: row.title,
    type: row.type,
    dueOn: row.due_on,
    priority: row.priority,
    objects: (row.objects ?? []) as DeadlineCardRow["objects"],
  }));
}

async function openInboxItems(tx: Tx): Promise<InboxCardRow[]> {
  const found = await rows<{
    id: string;
    status: InboxCardRow["status"];
    uncertainty_reason: string | null;
    created_at: string;
  }>(
    tx,
    sql`SELECT id, status, uncertainty_reason,
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_at
          FROM inbox_item
         WHERE status IN ('received', 'ambiguous')
         ORDER BY created_at
         LIMIT ${MAX_ROWS}`,
  );
  return found.map((row) => ({
    inboxItemId: row.id,
    status: row.status,
    uncertaintyReason: row.uncertainty_reason,
    occurredAt: row.created_at,
  }));
}

/**
 * The schema has no "document missing" flag on `lease`; the mandatory-document
 * signal it does carry is `unit_diagnostic.status`, on units under an active lease.
 */
async function missingDocuments(tx: Tx): Promise<MissingDocumentRow[]> {
  const found = await rows<{
    id: string;
    kind: string;
    status: string;
    unit_id: string;
    unit_label: string;
    lease_id: string;
    created_at: string;
  }>(
    tx,
    sql`SELECT DISTINCT d.id, d.kind, d.status, u.id AS unit_id, u.label AS unit_label, l.id AS lease_id,
               to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_at
          FROM unit_diagnostic d
          JOIN unit u ON u.id = d.unit_id
          JOIN lease_unit lu ON lu.unit_id = u.id
          JOIN lease l ON l.id = lu.lease_id AND l.status = 'active'
         WHERE d.status IN ('missing', 'expired')
         LIMIT ${MAX_ROWS}`,
  );
  return found.map((row) => ({
    id: row.id,
    label: `Diagnostic ${row.kind} du lot ${row.unit_label}`,
    objects: [
      { kind: "unit" as const, id: row.unit_id },
      { kind: "lease" as const, id: row.lease_id },
    ],
    occurredAt: row.created_at,
  }));
}

async function insuranceExceptions(tx: Tx, today: string): Promise<InsuranceExceptionRow[]> {
  const found = await rows<{
    id: string;
    insurer_name: string;
    policy_number: string | null;
    ends_on: string | null;
    has_certificate: boolean;
    created_at: string;
  }>(
    tx,
    sql`SELECT p.id, p.insurer_name, p.policy_number, p.ends_on::text AS ends_on,
               (p.last_certificate_document_id IS NOT NULL) AS has_certificate,
               to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_at
          FROM insurance_policy p
         WHERE p.status IN ('active', 'expiring', 'expired', 'to_verify')
         ORDER BY p.ends_on NULLS FIRST, p.created_at
         LIMIT ${MAX_ROWS}`,
  );
  return found.flatMap((row) => {
    const state = certificateState({
      hasCertificate: row.has_certificate,
      coverEndsOn: row.ends_on,
      today,
    });
    if (state !== "missing" && state !== "expired") return [];
    return [
      {
        policyId: row.id,
        label: `Police ${row.policy_number ?? "—"} (${row.insurer_name})`,
        state,
        endsOn: row.ends_on,
        occurredAt: row.created_at,
      },
    ];
  });
}

export async function loadCardSource(scope: TenantScope): Promise<CardSource> {
  return tenant(scope, async (tx) => {
    const day = await today(tx);
    return {
      today: day,
      lateRentTerms: await lateRentTerms(tx),
      commandExceptions: await commandExceptions(tx),
      pendingApprovals: await pendingApprovals(tx),
      deadlines: await dueDeadlines(tx),
      inboxItems: await openInboxItems(tx),
      missingDocuments: await missingDocuments(tx),
      insuranceExceptions: await insuranceExceptions(tx, day),
    };
  });
}

const NO_AMOUNT: AmountIndicator = { amount: null, currency: "EUR", asOf: null };

async function amount(tx: Tx, query: ReturnType<typeof sql>): Promise<AmountIndicator> {
  const found = await rows<{ total: string | null; as_of: string | null }>(tx, query);
  const row = found[0];
  if (!row || row.total === null) return NO_AMOUNT;
  return { amount: Number(row.total).toFixed(2), currency: "EUR", asOf: row.as_of };
}

async function occupancy(tx: Tx): Promise<OccupancyIndicator | null> {
  const found = await rows<{ total: string; occupied: string; as_of: string }>(
    tx,
    sql`SELECT count(*)::text AS total,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM lease_unit lu JOIN lease l ON l.id = lu.lease_id
                  WHERE lu.unit_id = u.id AND l.status = 'active'
                    AND lu.starts_on <= current_date
                    AND (lu.ends_on IS NULL OR lu.ends_on >= current_date)))::text AS occupied,
               to_char(current_date, 'YYYY-MM-DD') AS as_of
          FROM unit u
         WHERE u.status = 'active'`,
  );
  const row = found[0];
  if (!row || Number(row.total) === 0) return null;
  return {
    totalUnits: Number(row.total),
    occupiedUnits: Number(row.occupied),
    asOf: row.as_of,
  };
}

export async function loadSituation(scope: TenantScope): Promise<SituationResult> {
  // Probed outside the transaction: it can reach the network, a transaction must not wait on it.
  const model = await modelStatus();
  return tenant(scope, async (tx) => {
    const report = await rows<{ occurred_at: string; payload: unknown }>(
      tx,
      sql`SELECT to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS occurred_at, payload
            FROM event WHERE type = 'control_run' ORDER BY occurred_at DESC LIMIT 1`,
    );
    const last = report[0];

    return {
      banner: buildBanner(last ? { occurredAt: last.occurred_at, payload: last.payload } : null),
      model,
      indicators: {
        occupancy: await occupancy(tx),
        collectedThisMonth: await amount(
          tx,
          sql`SELECT sum(amount)::text AS total, to_char(max(received_on), 'YYYY-MM-DD') AS as_of
                FROM payment
               WHERE direction = 'inbound' AND status <> 'rejected'
                 AND received_on >= date_trunc('month', current_date)::date`,
        ),
        // No stored bank balance in the schema: a sum of movements is not a balance.
        cash: NO_AMOUNT,
        debt: await amount(
          tx,
          sql`SELECT sum(odoo_outstanding_principal)::text AS total,
                     to_char(max(odoo_read_at), 'YYYY-MM-DD') AS as_of
                FROM loan WHERE status = 'active'`,
        ),
        partnerAccounts: await amount(
          tx,
          sql`SELECT sum(odoo_balance)::text AS total,
                     to_char(max(odoo_read_at), 'YYYY-MM-DD') AS as_of
                FROM partner_current_account WHERE status = 'active'`,
        ),
        netBookValue: await amount(
          tx,
          sql`SELECT sum(net_book_value)::text AS total,
                     to_char(max(odoo_read_at), 'YYYY-MM-DD') AS as_of
                FROM fixed_asset WHERE disposed_on IS NULL AND status <> 'cancelled'`,
        ),
      },
    };
  });
}
