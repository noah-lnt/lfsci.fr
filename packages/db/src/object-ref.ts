import { AppError } from "@lfsci/kernel";
import { and, eq } from "drizzle-orm";
import type { Tx } from "./client";
import {
  activity,
  activityLink,
  deadline,
  deadlineLink,
  event,
  eventLink,
  objectRef,
} from "./generated/schema";

export const objectRefColumnByKind = {
  legal_entity: "legalEntityId",
  building: "buildingId",
  unit: "unitId",
  person: "personId",
  lease: "leaseId",
  rent_term: "rentTermId",
  payment: "paymentId",
  deposit_account: "depositAccountId",
  expense: "expenseId",
  works_project: "worksProjectId",
  intervention: "interventionId",
  equipment: "equipmentId",
  meter: "meterId",
  loan: "loanId",
  partner_current_account: "partnerCurrentAccountId",
  fixed_asset: "fixedAssetId",
  insurance_policy: "insurancePolicyId",
  claim: "claimId",
  booking: "bookingId",
  listing: "listingId",
  inspection: "inspectionId",
  supplier: "supplierId",
  bank_account: "bankAccountId",
  document: "documentId",
} as const;

export type ObjectKind = keyof typeof objectRefColumnByKind;

export type ObjectTarget = { organizationId: string; kind: ObjectKind; id: string };

/** Registry row for one business object, created once. Returns its uuid. */
export async function ensureObjectRef(tx: Tx, target: ObjectTarget): Promise<string> {
  const column = objectRefColumnByKind[target.kind];
  if (!column) {
    throw new AppError("VALIDATION", { message: `unknown object kind: ${target.kind}` });
  }
  const values = {
    organizationId: target.organizationId,
    kind: target.kind,
    [column]: target.id,
  } as typeof objectRef.$inferInsert;

  const inserted = await tx
    .insert(objectRef)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: objectRef.id });
  const created = inserted[0];
  if (created) return created.id;

  const existing = await tx
    .select({ id: objectRef.id })
    .from(objectRef)
    .where(and(eq(objectRef.kind, target.kind), eq(objectRef[column], target.id)))
    .limit(1);
  const found = existing[0];
  if (!found) {
    throw new AppError("CONFLICT", {
      message: "object_ref could not be created or read back",
      details: { kind: target.kind, id: target.id },
    });
  }
  return found.id;
}

export type LinkRelationOptions = {
  organizationId: string;
  objectRefId: string;
  relation?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  reason?: string;
};

export type ActivityLinkInput = LinkRelationOptions & { activityId: string; occurredAt?: string };
export type EventLinkInput = LinkRelationOptions & { eventId: string; occurredAt?: string };
export type DeadlineLinkInput = Omit<LinkRelationOptions, "effectiveFrom" | "effectiveTo"> & {
  deadlineId: string;
  dueOn?: string;
};

export async function linkActivity(tx: Tx, input: ActivityLinkInput): Promise<string> {
  const occurredAt = input.occurredAt ?? (await readOccurredAt(tx, "activity", input.activityId));
  const rows = await tx
    .insert(activityLink)
    .values({
      organizationId: input.organizationId,
      activityId: input.activityId,
      objectRefId: input.objectRefId,
      relation: input.relation ?? "about",
      occurredAt,
      ...optional(input),
    })
    .onConflictDoNothing()
    .returning({ id: activityLink.id });
  return (
    rows[0]?.id ??
    (await readLinkId(
      tx,
      activityLink,
      and(
        eq(activityLink.activityId, input.activityId),
        eq(activityLink.objectRefId, input.objectRefId),
        eq(activityLink.relation, input.relation ?? "about"),
      ),
    ))
  );
}

export async function linkEvent(tx: Tx, input: EventLinkInput): Promise<string> {
  const occurredAt = input.occurredAt ?? (await readOccurredAt(tx, "event", input.eventId));
  const rows = await tx
    .insert(eventLink)
    .values({
      organizationId: input.organizationId,
      eventId: input.eventId,
      objectRefId: input.objectRefId,
      relation: input.relation ?? "about",
      occurredAt,
      ...optional(input),
    })
    .onConflictDoNothing()
    .returning({ id: eventLink.id });
  return (
    rows[0]?.id ??
    (await readLinkId(
      tx,
      eventLink,
      and(
        eq(eventLink.eventId, input.eventId),
        eq(eventLink.objectRefId, input.objectRefId),
        eq(eventLink.relation, input.relation ?? "about"),
      ),
    ))
  );
}

export async function linkDeadline(tx: Tx, input: DeadlineLinkInput): Promise<string> {
  const dueOn = input.dueOn ?? (await readDueOn(tx, input.deadlineId));
  const rows = await tx
    .insert(deadlineLink)
    .values({
      organizationId: input.organizationId,
      deadlineId: input.deadlineId,
      objectRefId: input.objectRefId,
      relation: input.relation ?? "about",
      dueOn,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
    .onConflictDoNothing()
    .returning({ id: deadlineLink.id });
  return (
    rows[0]?.id ??
    (await readLinkId(
      tx,
      deadlineLink,
      and(
        eq(deadlineLink.deadlineId, input.deadlineId),
        eq(deadlineLink.objectRefId, input.objectRefId),
        eq(deadlineLink.relation, input.relation ?? "about"),
      ),
    ))
  );
}

function optional(input: LinkRelationOptions) {
  return {
    ...(input.effectiveFrom === undefined ? {} : { effectiveFrom: input.effectiveFrom }),
    ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}

async function readOccurredAt(tx: Tx, kind: "activity" | "event", id: string): Promise<string> {
  const table = kind === "activity" ? activity : event;
  const rows = await tx
    .select({ occurredAt: table.occurredAt })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { message: `${kind} ${id} not found` });
  return row.occurredAt;
}

async function readDueOn(tx: Tx, id: string): Promise<string> {
  const rows = await tx
    .select({ dueOn: deadline.dueOn })
    .from(deadline)
    .where(eq(deadline.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { message: `deadline ${id} not found` });
  return row.dueOn;
}

type LinkTable = typeof activityLink | typeof eventLink | typeof deadlineLink;

async function readLinkId(
  tx: Tx,
  table: LinkTable,
  where: ReturnType<typeof and>,
): Promise<string> {
  const rows = await tx.select({ id: table.id }).from(table).where(where).limit(1);
  const row = rows[0];
  if (!row) throw new AppError("CONFLICT", { message: "link row could not be read back" });
  return row.id;
}
