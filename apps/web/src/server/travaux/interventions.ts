import "server-only";
import type { Intervention } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { InterventionDetail, TransitionInterventionInput } from "@/lib/contracts/travaux";
import { type Actor, audit, planDeadline, recordFact } from "../finance/facts";
import {
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  offsetFromCursor,
  ruleViolation,
  today,
  versionConflict,
} from "../finance/shared";
import { mapIntervention, mapInterventionDetail } from "./mappers";

type Status = Intervention["status"];

/** MAI-01: signalée → qualifiée → planifiée → en cours → terminée, plus the SQL's escapes. */
const TRANSITIONS: Record<Status, Status[]> = {
  reported: ["qualified", "cancelled"],
  qualified: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["in_progress", "awaiting_part", "cancelled"],
  in_progress: ["done", "awaiting_part", "cancelled"],
  awaiting_part: ["in_progress", "cancelled"],
  done: ["reopened"],
  reopened: ["qualified", "in_progress", "cancelled"],
  cancelled: [],
};

async function deadlineOf(tx: Tx, interventionId: string): Promise<string | null> {
  const rows = await tx
    .select({ deadlineId: tables.deadlineLink.deadlineId })
    .from(tables.deadlineLink)
    .innerJoin(tables.objectRef, eq(tables.deadlineLink.objectRefId, tables.objectRef.id))
    .where(eq(tables.objectRef.interventionId, interventionId))
    .orderBy(desc(tables.deadlineLink.dueOn))
    .limit(1);
  return rows[0]?.deadlineId ?? null;
}

export async function listInterventions(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    worksProjectId?: string | undefined;
    buildingId?: string | undefined;
    unitId?: string | undefined;
    status?: string | undefined;
    urgency?: string | undefined;
    openOnly?: boolean | undefined;
  },
) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.worksProjectId ? eq(tables.intervention.worksProjectId, input.worksProjectId) : undefined,
    input.buildingId ? eq(tables.intervention.buildingId, input.buildingId) : undefined,
    input.unitId ? eq(tables.intervention.unitId, input.unitId) : undefined,
    input.status ? eq(tables.intervention.status, input.status) : undefined,
    input.urgency ? eq(tables.intervention.urgency, input.urgency) : undefined,
    input.openOnly ? notInArray(tables.intervention.status, ["done", "cancelled"]) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select()
    .from(tables.intervention)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.intervention.createdAt))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map(mapIntervention),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getIntervention(tx: Tx, id: string): Promise<InterventionDetail> {
  const row = firstOr(
    await tx.select().from(tables.intervention).where(eq(tables.intervention.id, id)).limit(1),
    "Intervention",
  );
  return mapInterventionDetail(
    row,
    TRANSITIONS[row.status as Status] ?? [],
    await deadlineOf(tx, id),
  );
}

export async function createIntervention(
  tx: Tx,
  actor: Actor,
  input: {
    title: string;
    description?: string | undefined;
    urgency?: Intervention["urgency"] | undefined;
    performedBy?: Intervention["performedBy"] | undefined;
    worksProjectId?: string | undefined;
    buildingId?: string | undefined;
    unitId?: string | undefined;
    equipmentId?: string | undefined;
    leaseId?: string | undefined;
    supplierId?: string | undefined;
    reportedOn?: string | undefined;
    scheduledOn?: string | undefined;
  },
): Promise<Intervention> {
  const row = firstOr(
    await tx
      .insert(tables.intervention)
      .values({
        organizationId: actor.organizationId,
        title: input.title,
        description: input.description ?? null,
        urgency: input.urgency ?? "normal",
        performedBy: input.performedBy ?? "owner",
        worksProjectId: input.worksProjectId ?? null,
        buildingId: input.buildingId ?? null,
        unitId: input.unitId ?? null,
        equipmentId: input.equipmentId ?? null,
        leaseId: input.leaseId ?? null,
        supplierId: input.supplierId ?? null,
        reportedOn: input.reportedOn ?? today(),
        scheduledOn: input.scheduledOn ?? null,
        status: "reported",
      })
      .returning(),
    "Intervention",
  );

  await recordFact(tx, actor, {
    kind: "intervention",
    id: row.id,
    type: "intervention.reported",
    payload: { title: row.title, urgency: row.urgency },
  });
  await audit(tx, actor, {
    objectTable: "intervention",
    objectId: row.id,
    action: "create",
    after: { title: row.title, status: row.status },
  });
  return mapIntervention(row);
}

/**
 * MAI-01 / WF-06: closing demands the observed result and the time spent; the
 * fact is an Event and, when a next check is set, a Deadline anchored on it.
 */
export async function transitionIntervention(
  tx: Tx,
  actor: Actor,
  input: TransitionInterventionInput,
): Promise<InterventionDetail> {
  const row = firstOr(
    await tx
      .select()
      .from(tables.intervention)
      .where(eq(tables.intervention.id, input.id))
      .limit(1),
    "Intervention",
  );
  if (row.version !== input.expectedVersion) versionConflict("L’intervention");

  const from = row.status as Status;
  if (!TRANSITIONS[from].includes(input.to)) {
    ruleViolation(`Une intervention « ${from} » ne peut pas passer à « ${input.to} ».`);
  }
  if (input.to === "done") {
    if (!input.observedResult) ruleViolation("La clôture exige le résultat observé (MAI-01).");
    if (!input.ownerHours) ruleViolation("La clôture exige le temps passé (TRA-02).");
  }

  const completedOn = input.to === "done" ? (input.completedOn ?? today()) : row.completedOn;
  const updated = firstOr(
    await tx
      .update(tables.intervention)
      .set({
        status: input.to,
        ...(input.scheduledOn === undefined ? {} : { scheduledOn: input.scheduledOn }),
        ...(input.observedResult === undefined ? {} : { observedResult: input.observedResult }),
        ...(input.ownerHours === undefined ? {} : { ownerHours: input.ownerHours }),
        ...(input.ownerHourlyValue === undefined
          ? {}
          : { ownerHourlyValue: input.ownerHourlyValue }),
        ...(input.nextCheckOn === undefined ? {} : { nextCheckOn: input.nextCheckOn }),
        completedOn,
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(tables.intervention.id, input.id), eq(tables.intervention.version, row.version)),
      )
      .returning(),
    "Intervention",
  );

  const { objectRefId } = await recordFact(tx, actor, {
    kind: "intervention",
    id: updated.id,
    type: `intervention.${input.to}`,
    payload: {
      from,
      to: input.to,
      ...(input.observedResult ? { observedResult: input.observedResult } : {}),
      ...(input.ownerHours ? { ownerHours: input.ownerHours } : {}),
    },
  });

  if (input.nextCheckOn) {
    await planDeadline(tx, actor, {
      type: "intervention_check",
      title: `Contrôle : ${updated.title}`,
      dueOn: input.nextCheckOn,
      priority: updated.urgency === "critical" ? "high" : "normal",
      objectRefId,
      relation: "about",
    });
  }

  await audit(tx, actor, {
    objectTable: "intervention",
    objectId: updated.id,
    objectRefId,
    action: `transition:${input.to}`,
    before: { status: from },
    after: { status: input.to, completedOn },
    ...(input.reason ? { reason: input.reason } : {}),
  });

  return mapInterventionDetail(updated, TRANSITIONS[input.to], await deadlineOf(tx, updated.id));
}
