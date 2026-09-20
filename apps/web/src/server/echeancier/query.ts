import "server-only";
import type { Tx } from "@lfsci/db";
import { ensureObjectRef, linkEvent, recordAudit } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { DeadlineListResult, DeadlineRow } from "@/lib/contracts/echeancier";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { countByHorizon, horizonOf } from "./horizon";

const OPEN = ["planned", "to_process", "postponed", "blocked"] as const;

// drizzle expands a JS array into a tuple, which the ANY operator rejects.
const OPEN_LIST = sql.join(
  OPEN.map((status) => sql`${status}`),
  sql`, `,
);

const OBJECT_ID = sql`COALESCE(o.legal_entity_id, o.building_id, o.unit_id, o.person_id, o.lease_id,
  o.rent_term_id, o.payment_id, o.deposit_account_id, o.expense_id, o.works_project_id,
  o.intervention_id, o.equipment_id, o.meter_id, o.loan_id, o.partner_current_account_id,
  o.fixed_asset_id, o.insurance_policy_id, o.claim_id, o.booking_id, o.listing_id,
  o.inspection_id, o.supplier_id, o.bank_account_id, o.document_id)`;

type RawDeadline = {
  id: string;
  version: number;
  type: string;
  title: string;
  due_on: string;
  original_due_on: string | null;
  priority: DeadlineRow["priority"];
  status: DeadlineRow["status"];
  assignee_user_id: string | null;
  postponed_reason: string | null;
  completed_at: string | null;
  objects: { kind: string; id: string }[] | null;
};

const SELECT = sql`
  SELECT d.id, d.version, d.type, d.title,
         to_char(d.due_on, 'YYYY-MM-DD') AS due_on,
         to_char(d.original_due_on, 'YYYY-MM-DD') AS original_due_on,
         d.priority, d.status, d.assignee_user_id, d.postponed_reason,
         to_char(d.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS completed_at,
         (SELECT json_agg(json_build_object('kind', o.kind, 'id', ${OBJECT_ID}))
            FROM deadline_link dl JOIN object_ref o ON o.id = dl.object_ref_id
           WHERE dl.deadline_id = d.id) AS objects
    FROM deadline d`;

function toRow(raw: RawDeadline, today: string): DeadlineRow {
  return {
    id: raw.id,
    version: raw.version,
    type: raw.type,
    title: raw.title,
    dueOn: raw.due_on,
    originalDueOn: raw.original_due_on,
    priority: raw.priority,
    status: raw.status,
    assigneeUserId: raw.assignee_user_id,
    postponedReason: raw.postponed_reason,
    completedAt: raw.completed_at,
    horizon: horizonOf(raw.due_on, today),
    objects: (raw.objects ?? []) as DeadlineRow["objects"],
  };
}

async function today(tx: Tx): Promise<string> {
  const found = [
    ...(await tx.execute<{ day: string }>(
      sql`SELECT to_char((now() AT TIME ZONE 'Europe/Paris')::date, 'YYYY-MM-DD') AS day`,
    )),
  ];
  return found[0]?.day ?? new Date().toISOString().slice(0, 10);
}

async function read(tx: Tx, id: string, day: string): Promise<DeadlineRow> {
  const found = [
    ...(await tx.execute<RawDeadline>(sql`${SELECT} WHERE d.id = ${id}::uuid LIMIT 1`)),
  ] as RawDeadline[];
  const row = found[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { deadlineId: id } });
  return toRow(row, day);
}

export type ListInput = {
  horizon?: string | undefined;
  type?: string | undefined;
  assigneeUserId?: string | undefined;
  objectId?: string | undefined;
  includeClosed: boolean;
  limit: number;
};

export async function listDeadlines(
  scope: TenantScope,
  input: ListInput,
): Promise<DeadlineListResult> {
  return tenant(scope, async (tx) => {
    const day = await today(tx);
    const where = [input.includeClosed ? sql`TRUE` : sql`d.status IN (${OPEN_LIST})`];
    if (input.type) where.push(sql`d.type = ${input.type}`);
    if (input.assigneeUserId) where.push(sql`d.assignee_user_id = ${input.assigneeUserId}::uuid`);
    if (input.objectId) {
      where.push(sql`EXISTS (SELECT 1 FROM deadline_link dl JOIN object_ref o2 ON o2.id = dl.object_ref_id
                              WHERE dl.deadline_id = d.id AND o2.id = ${input.objectId}::uuid)`);
    }
    const found = [
      ...(await tx.execute<RawDeadline>(
        sql`${SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY d.due_on LIMIT ${input.limit}`,
      )),
    ] as RawDeadline[];

    const all = found.map((raw) => toRow(raw, day));
    const items = input.horizon ? all.filter((row) => row.horizon === input.horizon) : all;
    return { items, counts: countByHorizon(all) };
  });
}

/** TMP-01: completion references a real event; `due_on` is never overwritten. */
export async function completeDeadline(
  scope: TenantScope,
  input: {
    id: string;
    expectedVersion: number;
    observedOn?: string | undefined;
    note?: string | undefined;
  },
): Promise<DeadlineRow> {
  const organizationId = scope.organizationId;
  const actorId = scope.session?.user.id ?? null;

  return tenant(scope, async (tx) => {
    const day = await today(tx);
    const current = await read(tx, input.id, day);
    const objectRefId = await anchorObjectRef(tx, organizationId, input.id);

    const inserted = [
      ...(await tx.execute<{ id: string }>(sql`
        INSERT INTO event (organization_id, type, primary_object_ref_id, effective_on, occurred_at,
                           origin, actor_user_id, payload)
        VALUES (${organizationId}::uuid, 'deadline_completed', ${objectRefId}::uuid,
                ${input.observedOn ?? day}::date, now(), 'user', ${actorId}::uuid,
                ${JSON.stringify({ deadlineId: input.id, note: input.note ?? null })}::jsonb)
        RETURNING id`)),
    ];
    const event = inserted[0];
    if (!event) throw new AppError("CONFLICT", { message: "event insert returned no row" });
    await linkEvent(tx, { organizationId, eventId: event.id, objectRefId, relation: "primary" });

    const updated = [
      ...(await tx.execute<{ id: string }>(sql`
        UPDATE deadline
           SET status = 'done', completed_event_id = ${event.id}::uuid, completed_at = now(),
               version = version + 1, updated_at = now()
         WHERE id = ${input.id}::uuid AND version = ${input.expectedVersion}
        RETURNING id`)),
    ];
    if (updated.length === 0) {
      throw new AppError("VERSION_CONFLICT", {
        details: { deadlineId: input.id, expectedVersion: input.expectedVersion },
      });
    }

    await recordAudit(tx, {
      organizationId,
      actorKind: actorId ? "user" : "system",
      actorUserId: actorId,
      objectTable: "deadline",
      objectId: input.id,
      action: "deadline.complete",
      reason: input.note ?? null,
      beforeValue: { status: current.status },
      afterValue: { status: "done", eventId: event.id },
    });

    return read(tx, input.id, day);
  });
}

/** TMP-03: the initial date survives the report; the reason is required. */
export async function postponeDeadline(
  scope: TenantScope,
  input: { id: string; expectedVersion: number; newDueOn: string; reason: string },
): Promise<DeadlineRow> {
  const organizationId = scope.organizationId;
  const actorId = scope.session?.user.id ?? null;

  return tenant(scope, async (tx) => {
    const day = await today(tx);
    const current = await read(tx, input.id, day);

    const updated = [
      ...(await tx.execute<{ id: string }>(sql`
        UPDATE deadline
           SET original_due_on = COALESCE(original_due_on, due_on),
               due_on = ${input.newDueOn}::date,
               status = 'postponed',
               postponed_reason = ${input.reason},
               version = version + 1, updated_at = now()
         WHERE id = ${input.id}::uuid AND version = ${input.expectedVersion}
        RETURNING id`)),
    ];
    if (updated.length === 0) {
      throw new AppError("VERSION_CONFLICT", {
        details: { deadlineId: input.id, expectedVersion: input.expectedVersion },
      });
    }
    await tx.execute(
      sql`UPDATE deadline_link SET due_on = ${input.newDueOn}::date WHERE deadline_id = ${input.id}::uuid`,
    );

    await recordAudit(tx, {
      organizationId,
      actorKind: actorId ? "user" : "system",
      actorUserId: actorId,
      objectTable: "deadline",
      objectId: input.id,
      action: "deadline.postpone",
      reason: input.reason,
      beforeValue: { dueOn: current.dueOn },
      afterValue: { dueOn: input.newDueOn },
    });

    return read(tx, input.id, day);
  });
}

/** `event.primary_object_ref_id` is NOT NULL: use the deadline's own object, else the entity. */
async function anchorObjectRef(tx: Tx, organizationId: string, id: string): Promise<string> {
  const linked = [
    ...(await tx.execute<{ object_ref_id: string }>(
      sql`SELECT object_ref_id FROM deadline_link WHERE deadline_id = ${id}::uuid LIMIT 1`,
    )),
  ];
  const found = linked[0];
  if (found) return found.object_ref_id;

  const entities = [
    ...(await tx.execute<{ id: string }>(sql`SELECT id FROM legal_entity ORDER BY name LIMIT 1`)),
  ];
  const entity = entities[0];
  if (!entity) {
    throw new AppError("RULE_VIOLATION", {
      message: "Aucun objet rattaché à cette échéance et aucune société pour porter l’événement.",
    });
  }
  return ensureObjectRef(tx, { organizationId, kind: "legal_entity", id: entity.id });
}
