import "server-only";
import {
  ensureObjectRef,
  linkDeadline,
  linkEvent,
  type ObjectKind,
  recordAudit,
  type Tx,
  tables,
} from "@lfsci/db";

export type Actor = { organizationId: string; actorUserId: string | null };

export type FactInput = {
  kind: ObjectKind;
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
};

/** Registers the object, writes the event and links it to that object's timeline. */
export async function recordFact(
  tx: Tx,
  actor: Actor,
  fact: FactInput,
): Promise<{ eventId: string; objectRefId: string }> {
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: fact.kind,
    id: fact.id,
  });
  const occurredAt = fact.occurredAt ?? new Date().toISOString();
  const inserted = await tx
    .insert(tables.event)
    .values({
      organizationId: actor.organizationId,
      type: fact.type,
      primaryObjectRefId: objectRefId,
      occurredAt,
      origin: "user",
      actorUserId: actor.actorUserId,
      payload: fact.payload ?? {},
    })
    .returning({ id: tables.event.id });
  const eventId = inserted[0]?.id;
  if (!eventId) throw new Error("event insert returned no row");
  await linkEvent(tx, {
    organizationId: actor.organizationId,
    eventId,
    objectRefId,
    relation: "about",
    occurredAt,
  });
  return { eventId, objectRefId };
}

export type AuditInput = {
  objectTable: string;
  objectId: string;
  objectRefId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
};

export async function audit(tx: Tx, actor: Actor, entry: AuditInput): Promise<void> {
  await recordAudit(tx, {
    organizationId: actor.organizationId,
    actorKind: "user",
    actorUserId: actor.actorUserId,
    objectTable: entry.objectTable,
    objectId: entry.objectId,
    objectRefId: entry.objectRefId ?? null,
    action: entry.action,
    beforeValue: entry.before ?? null,
    afterValue: entry.after ?? null,
    reason: entry.reason ?? null,
    source: "web",
  });
}

export type DeadlineInput = {
  type: string;
  title: string;
  dueOn: string;
  priority?: "low" | "normal" | "high" | "critical";
  objectRefId: string;
  relation?: string;
};

/** TMP-03: a control anchored on the execution date, created with the closing fact. */
export async function planDeadline(tx: Tx, actor: Actor, input: DeadlineInput): Promise<string> {
  const inserted = await tx
    .insert(tables.deadline)
    .values({
      organizationId: actor.organizationId,
      type: input.type,
      title: input.title,
      dueOn: input.dueOn,
      priority: input.priority ?? "normal",
      recurrenceAnchor: "execution_date",
      status: "planned",
    })
    .returning({ id: tables.deadline.id });
  const deadlineId = inserted[0]?.id;
  if (!deadlineId) throw new Error("deadline insert returned no row");
  await linkDeadline(tx, {
    organizationId: actor.organizationId,
    deadlineId,
    objectRefId: input.objectRefId,
    relation: input.relation ?? "about",
    dueOn: input.dueOn,
  });
  return deadlineId;
}
