import "server-only";
import {
  ensureObjectRef,
  linkEvent,
  type ObjectKind,
  recordAudit,
  type Tx,
  tables,
} from "@lfsci/db";

export type Actor = { organizationId: string; actorUserId: string | null };

export async function audit(
  tx: Tx,
  actor: Actor,
  entry: {
    objectTable: string;
    objectId: string;
    action: string;
    beforeValue?: unknown;
    afterValue?: unknown;
  },
): Promise<void> {
  await recordAudit(tx, {
    organizationId: actor.organizationId,
    actorKind: actor.actorUserId ? "user" : "system",
    actorUserId: actor.actorUserId,
    source: "web",
    ...entry,
  });
}

/** TMP-01: a business fact is an `event` linked to the objects it concerns. */
export async function emitEvent(
  tx: Tx,
  actor: Actor,
  input: {
    type: string;
    kind: ObjectKind;
    id: string;
    effectiveOn?: string;
    payload?: Record<string, unknown>;
    also?: { kind: ObjectKind; id: string }[];
  },
): Promise<string> {
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: input.kind,
    id: input.id,
  });
  const occurredAt = new Date().toISOString();
  const rows = await tx
    .insert(tables.event)
    .values({
      organizationId: actor.organizationId,
      type: input.type,
      primaryObjectRefId: objectRefId,
      occurredAt,
      origin: "saas",
      actorUserId: actor.actorUserId,
      payload: input.payload ?? {},
      ...(input.effectiveOn ? { effectiveOn: input.effectiveOn } : {}),
    })
    .returning({ id: tables.event.id });
  const eventId = rows[0]?.id;
  if (!eventId) throw new Error("event insert returned no row");

  await linkEvent(tx, {
    organizationId: actor.organizationId,
    eventId,
    objectRefId,
    occurredAt,
  });
  for (const target of input.also ?? []) {
    const linked = await ensureObjectRef(tx, {
      organizationId: actor.organizationId,
      kind: target.kind,
      id: target.id,
    });
    await linkEvent(tx, {
      organizationId: actor.organizationId,
      eventId,
      objectRefId: linked,
      relation: "context",
      occurredAt,
    });
  }
  return eventId;
}
