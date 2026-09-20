import "server-only";
import type { Activity, Deadline, EventEntity, ObjectRef, TimelineItem } from "@lfsci/contracts";
import { objectRefColumnByKind, type Tx, tables } from "@lfsci/db";
import { eq, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { decodeCursor, encodeCursor, instant, instantOrNull, objectRefFromRow } from "./rows";

export type TimelineArgs = {
  object: ObjectRef;
  cursor?: string | undefined;
  limit: number;
  from?: string | undefined;
  to?: string | undefined;
  kinds?: readonly ("activity" | "event" | "deadline")[] | undefined;
};

type IndexRow = { item_kind: "activity" | "event" | "deadline"; id: string; sorted_at: string };

const emptyPage = { items: [] as TimelineItem[], nextCursor: null };

/** Resolves `{kind, id}` to its `object_ref` row id, or null when the object has none yet. */
export async function objectRefId(tx: Tx, object: ObjectRef): Promise<string | null> {
  const column = objectRefColumnByKind[object.kind];
  if (!column) return null;
  const rows = await tx
    .select({ id: tables.objectRef.id })
    .from(tables.objectRef)
    .where(
      sql`${tables.objectRef.kind} = ${object.kind} AND ${tables.objectRef[column]} = ${object.id}::uuid`,
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function objectsByOwner(
  linkTable: typeof tables.activityLink | typeof tables.eventLink | typeof tables.deadlineLink,
  ownerColumn: PgColumn,
  tx: Tx,
  ids: string[],
): Promise<Map<string, ObjectRef[]>> {
  const grouped = new Map<string, ObjectRef[]>();
  if (ids.length === 0) return grouped;
  const rows = await tx
    .select({ owner: ownerColumn, ref: tables.objectRef })
    .from(linkTable)
    .innerJoin(tables.objectRef, eq(tables.objectRef.id, linkTable.objectRefId))
    .where(inArray(ownerColumn, ids));
  for (const row of rows) {
    const owner = String(row.owner);
    const list = grouped.get(owner) ?? [];
    list.push(objectRefFromRow(row.ref));
    grouped.set(owner, list);
  }
  return grouped;
}

async function readActivities(tx: Tx, ids: string[]): Promise<Map<string, Activity>> {
  const out = new Map<string, Activity>();
  if (ids.length === 0) return out;
  const rows = await tx.select().from(tables.activity).where(inArray(tables.activity.id, ids));
  const objects = await objectsByOwner(
    tables.activityLink,
    tables.activityLink.activityId,
    tx,
    ids,
  );
  for (const row of rows) {
    out.set(row.id, {
      id: row.id,
      createdAt: instant(row.createdAt),
      updatedAt: instantOrNull(row.updatedAt),
      version: row.version,
      channel: row.channel as Activity["channel"],
      direction: row.direction as Activity["direction"],
      subject: row.subject,
      bodyRaw: row.bodyRaw,
      declaredAuthor: row.declaredAuthor,
      authorPersonId: row.authorPersonId,
      authorUserId: row.authorUserId,
      externalId: row.externalId,
      capturedAt: instantOrNull(row.capturedAt),
      receivedAt: instant(row.receivedAt),
      occurredAt: instant(row.occurredAt),
      objects: objects.get(row.id) ?? [],
    });
  }
  return out;
}

async function readEvents(tx: Tx, ids: string[]): Promise<Map<string, EventEntity>> {
  const out = new Map<string, EventEntity>();
  if (ids.length === 0) return out;
  const rows = await tx
    .select({ event: tables.event, primary: tables.objectRef })
    .from(tables.event)
    .innerJoin(tables.objectRef, eq(tables.objectRef.id, tables.event.primaryObjectRefId))
    .where(inArray(tables.event.id, ids));
  const objects = await objectsByOwner(tables.eventLink, tables.eventLink.eventId, tx, ids);
  for (const { event: row, primary } of rows) {
    out.set(row.id, {
      id: row.id,
      createdAt: instant(row.createdAt),
      updatedAt: instantOrNull(row.updatedAt),
      version: row.version,
      type: row.type,
      primaryObject: objectRefFromRow(primary),
      effectiveOn: row.effectiveOn,
      occurredAt: instant(row.occurredAt),
      recordedAt: instant(row.recordedAt),
      origin: row.origin as EventEntity["origin"],
      actorUserId: row.actorUserId,
      actorLabel: row.actorLabel,
      sourceActivityId: row.sourceActivityId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      objects: objects.get(row.id) ?? [],
    });
  }
  return out;
}

async function readDeadlines(tx: Tx, ids: string[]): Promise<Map<string, Deadline>> {
  const out = new Map<string, Deadline>();
  if (ids.length === 0) return out;
  const rows = await tx.select().from(tables.deadline).where(inArray(tables.deadline.id, ids));
  const objects = await objectsByOwner(
    tables.deadlineLink,
    tables.deadlineLink.deadlineId,
    tx,
    ids,
  );
  for (const row of rows) {
    out.set(row.id, {
      id: row.id,
      createdAt: instant(row.createdAt),
      updatedAt: instantOrNull(row.updatedAt),
      version: row.version,
      type: row.type,
      title: row.title,
      dueOn: row.dueOn,
      originalDueOn: row.originalDueOn,
      remindFromOn: row.remindFromOn,
      priority: row.priority as Deadline["priority"],
      assigneeUserId: row.assigneeUserId,
      ruleVersionId: row.ruleVersionId,
      recurrenceRule: row.recurrenceRule,
      recurrenceAnchor: row.recurrenceAnchor as Deadline["recurrenceAnchor"],
      parentDeadlineId: row.parentDeadlineId,
      status: row.status as Deadline["status"],
      postponedReason: row.postponedReason,
      cancelledReason: row.cancelledReason,
      completedEventId: row.completedEventId,
      completedAt: instantOrNull(row.completedAt),
      objects: objects.get(row.id) ?? [],
    });
  }
  return out;
}

/**
 * TMP-02: one canonical row per fact, reached through `object_ref` links, so
 * the SCI, the building and the lot each see the same event from their side.
 * Keyset pagination on `(occurred_at, id)` (tech pack §8).
 */
export async function readTimeline(
  tx: Tx,
  args: TimelineArgs,
): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
  const refId = await objectRefId(tx, args.object);
  if (!refId) return emptyPage;

  const kinds = args.kinds && args.kinds.length > 0 ? [...args.kinds] : null;
  const cursor = args.cursor ? decodeCursor(args.cursor) : null;

  const rows = await tx.execute<IndexRow>(sql`
    SELECT t.item_kind, t.id, t.sort_at::text AS sorted_at
    FROM (
      SELECT 'activity'::text AS item_kind, a.id::text AS id, a.occurred_at AS sort_at
        FROM activity a JOIN activity_link al ON al.activity_id = a.id
        WHERE al.object_ref_id = ${refId}::uuid
      UNION ALL
      SELECT 'event'::text, e.id::text, e.occurred_at
        FROM event e JOIN event_link el ON el.event_id = e.id
        WHERE el.object_ref_id = ${refId}::uuid
      UNION ALL
      SELECT 'deadline'::text, d.id::text, (d.due_on::timestamp AT TIME ZONE 'UTC')
        FROM deadline d JOIN deadline_link dl ON dl.deadline_id = d.id
        WHERE dl.object_ref_id = ${refId}::uuid
    ) t
    WHERE (${kinds}::text[] IS NULL OR t.item_kind = ANY(${kinds}::text[]))
      AND (${args.from ?? null}::date IS NULL OR t.sort_at >= ${args.from ?? null}::date)
      AND (${args.to ?? null}::date IS NULL OR t.sort_at < (${args.to ?? null}::date + 1))
      AND (${cursor?.at ?? null}::timestamptz IS NULL
           OR (t.sort_at, t.id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::text))
    ORDER BY t.sort_at DESC, t.id DESC
    LIMIT ${args.limit + 1}
  `);

  const index = [...rows];
  const pageRows = index.slice(0, args.limit);
  if (pageRows.length === 0) return emptyPage;

  const pick = (kind: IndexRow["item_kind"]) =>
    pageRows.filter((row) => row.item_kind === kind).map((row) => row.id);

  const [activities, events, deadlines] = await Promise.all([
    readActivities(tx, pick("activity")),
    readEvents(tx, pick("event")),
    readDeadlines(tx, pick("deadline")),
  ]);

  const items: TimelineItem[] = [];
  for (const row of pageRows) {
    if (row.item_kind === "activity") {
      const activity = activities.get(row.id);
      if (activity) items.push({ itemKind: "activity", activity });
    } else if (row.item_kind === "event") {
      const event = events.get(row.id);
      if (event) items.push({ itemKind: "event", event });
    } else {
      const deadline = deadlines.get(row.id);
      if (deadline) items.push({ itemKind: "deadline", deadline });
    }
  }

  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: index.length > args.limit && last ? encodeCursor(last.sorted_at, last.id) : null,
  };
}
