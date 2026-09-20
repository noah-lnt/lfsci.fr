import "server-only";
import type { ObjectRef } from "@lfsci/contracts";
import type { Tx } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { AttachTarget, InboxDetail, InboxListResult, InboxRow } from "@/lib/contracts/inbox";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";

export const OPEN_STATUSES = ["received", "analyzed", "ambiguous", "suspected_duplicate"] as const;

// drizzle expands a JS array into a tuple, which the ANY operator rejects.
const OPEN_LIST = sql.join(
  OPEN_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

const OBJECT_ID = sql`COALESCE(o.legal_entity_id, o.building_id, o.unit_id, o.person_id, o.lease_id,
  o.rent_term_id, o.payment_id, o.deposit_account_id, o.expense_id, o.works_project_id,
  o.intervention_id, o.equipment_id, o.meter_id, o.loan_id, o.partner_current_account_id,
  o.fixed_asset_id, o.insurance_policy_id, o.claim_id, o.booking_id, o.listing_id,
  o.inspection_id, o.supplier_id, o.bank_account_id, o.document_id)`;

const SELECT_ROW = sql`
  SELECT i.id, i.version, i.source, i.source_reference, i.status,
         to_char(COALESCE(a.received_at, i.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS received_at,
         a.subject, a.body_raw, a.channel, a.declared_author,
         i.document_id, i.activity_id, i.proposed_action, i.uncertainty_reason,
         o.kind AS object_kind, ${OBJECT_ID} AS object_id
    FROM inbox_item i
    LEFT JOIN activity a ON a.id = i.activity_id
    LEFT JOIN object_ref o ON o.id = i.proposed_object_ref_id`;

type RawRow = {
  id: string;
  version: number;
  source: string;
  source_reference: string | null;
  status: string;
  received_at: string;
  subject: string | null;
  body_raw: string | null;
  channel: string | null;
  declared_author: string | null;
  document_id: string | null;
  activity_id: string | null;
  proposed_action: string | null;
  uncertainty_reason: string | null;
  object_kind: string | null;
  object_id: string | null;
};

function summarize(row: RawRow): string | null {
  const text = row.subject ?? row.body_raw;
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 179)}…` : flat;
}

export function toRow(row: RawRow): InboxRow {
  const proposed: ObjectRef | null =
    row.object_kind && row.object_id
      ? ({ kind: row.object_kind, id: row.object_id } as ObjectRef)
      : null;
  return {
    id: row.id,
    version: row.version,
    source: row.source as InboxRow["source"],
    sourceReference: row.source_reference,
    status: row.status as InboxRow["status"],
    receivedAt: row.received_at,
    summary: summarize(row),
    channel: row.channel,
    declaredAuthor: row.declared_author,
    documentId: row.document_id,
    activityId: row.activity_id,
    proposedObject: proposed,
    proposedObjectLabel: proposed ? `${proposed.kind} ${proposed.id.slice(0, 8)}` : null,
    proposedAction: row.proposed_action,
    uncertaintyReason: row.uncertainty_reason,
  };
}

export async function readRow(tx: Tx, id: string): Promise<RawRow> {
  const found = [
    ...(await tx.execute<RawRow>(sql`${SELECT_ROW} WHERE i.id = ${id}::uuid LIMIT 1`)),
  ] as RawRow[];
  const row = found[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { inboxItemId: id } });
  return row;
}

export async function listInbox(
  scope: TenantScope,
  input: { status?: string | undefined; openOnly: boolean; limit: number },
): Promise<InboxListResult> {
  return tenant(scope, async (tx) => {
    const filter = input.status
      ? sql`WHERE i.status = ${input.status}`
      : input.openOnly
        ? sql`WHERE i.status IN (${OPEN_LIST})`
        : sql``;
    const found = [
      ...(await tx.execute<RawRow>(
        sql`${SELECT_ROW} ${filter} ORDER BY COALESCE(a.received_at, i.created_at) DESC LIMIT ${input.limit}`,
      )),
    ] as RawRow[];
    const counted = [
      ...(await tx.execute<{ open: string }>(
        sql`SELECT count(*)::text AS open FROM inbox_item WHERE status IN (${OPEN_LIST})`,
      )),
    ];
    return { items: found.map(toRow), openCount: Number(counted[0]?.open ?? 0) };
  });
}

export async function getInbox(scope: TenantScope, id: string): Promise<InboxDetail> {
  return tenant(scope, async (tx) => {
    const raw = await readRow(tx, id);
    const fields = [
      ...(await tx.execute<{
        field_path: string;
        proposed_value: string | null;
        confidence: string | null;
        evidence_excerpt: string | null;
        decision: string;
      }>(
        sql`SELECT field_path, proposed_value, confidence::text, evidence_excerpt, decision
              FROM ai_extraction WHERE inbox_item_id = ${id}::uuid ORDER BY field_path`,
      )),
    ];
    return {
      ...toRow(raw),
      subject: raw.subject,
      bodyRaw: raw.body_raw,
      fields: fields.map((field) => ({
        fieldPath: field.field_path,
        value: field.proposed_value,
        confidence: field.confidence,
        evidenceExcerpt: field.evidence_excerpt,
        decision: field.decision,
      })),
    };
  });
}

export type AttachTargetRow = { kind: string; id: string; label: string };

/** The objects an inbox item can be attached to, one short list for the triage form. */
export async function listAttachTargets(
  scope: TenantScope,
  input: { query?: string | undefined; limit: number },
): Promise<{ items: AttachTarget[] }> {
  const pattern = `%${input.query ?? ""}%`;
  return tenant(scope, async (tx) => {
    const rows = [
      ...(await tx.execute<AttachTargetRow>(sql`
        SELECT 'legal_entity' AS kind, id, name AS label FROM legal_entity WHERE name ILIKE ${pattern}
         UNION ALL
        SELECT 'building', id, name FROM building WHERE name ILIKE ${pattern}
         UNION ALL
        SELECT 'unit', id, label FROM unit WHERE label ILIKE ${pattern}
         UNION ALL
        SELECT 'lease', id, reference FROM lease WHERE reference ILIKE ${pattern}
         ORDER BY kind, label
         LIMIT ${input.limit}`)),
    ] as AttachTargetRow[];
    return {
      items: rows.map((row) => ({
        object: { kind: row.kind, id: row.id } as AttachTarget["object"],
        label: row.label,
      })),
    };
  });
}
