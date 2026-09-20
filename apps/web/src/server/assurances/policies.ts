import "server-only";
import { ensureObjectRef, type Tx, tables } from "@lfsci/db";
import { certificateDueOn, isCertificateException } from "@lfsci/domain";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type {
  AddPolicyScopeInput,
  ClosePolicyScopeInput,
  CreatePolicyInput,
  PolicyDeadlineRow,
  PolicyDetail,
  PolicyExceptionRow,
  PolicyRow,
  PolicyScopeRow,
  UpdatePolicyInput,
} from "@/lib/contracts/assurances";
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
import { mapPolicy, mapPolicyScope, policyCertificate, scopeTargetOf } from "./mappers";

export const CERTIFICATE_DEADLINE_TYPE = "insurance_certificate";
const OPEN_DEADLINES = ["planned", "to_process", "postponed", "blocked"];

type ScopeRowIn = typeof tables.policyScope.$inferSelect;

function labelOf(row: {
  scope: ScopeRowIn;
  buildingName: string | null;
  unitCode: string | null;
  unitLabel: string | null;
  equipmentLabel: string | null;
  leaseReference: string | null;
  loanLender: string | null;
  loanReference: string | null;
}): string {
  const target = scopeTargetOf(row.scope);
  switch (target.kind) {
    case "building":
      return row.buildingName ?? "Immeuble";
    case "unit":
      return [row.unitCode, row.unitLabel].filter((part) => part).join(" — ") || "Lot";
    case "equipment":
      return row.equipmentLabel ?? "Équipement";
    case "lease":
      return row.leaseReference ?? "Bail";
    default:
      return [row.loanLender, row.loanReference].filter((part) => part).join(" · ") || "Crédit";
  }
}

async function scopesByPolicy(
  tx: Tx,
  policyIds: readonly string[],
): Promise<Map<string, PolicyScopeRow[]>> {
  const grouped = new Map<string, PolicyScopeRow[]>();
  if (policyIds.length === 0) return grouped;
  const rows = await tx
    .select({
      scope: tables.policyScope,
      buildingName: tables.building.name,
      unitCode: tables.unit.code,
      unitLabel: tables.unit.label,
      equipmentLabel: tables.equipment.label,
      leaseReference: tables.lease.reference,
      loanLender: tables.loan.lenderName,
      loanReference: tables.loan.reference,
    })
    .from(tables.policyScope)
    .leftJoin(tables.building, eq(tables.policyScope.buildingId, tables.building.id))
    .leftJoin(tables.unit, eq(tables.policyScope.unitId, tables.unit.id))
    .leftJoin(tables.equipment, eq(tables.policyScope.equipmentId, tables.equipment.id))
    .leftJoin(tables.lease, eq(tables.policyScope.leaseId, tables.lease.id))
    .leftJoin(tables.loan, eq(tables.policyScope.loanId, tables.loan.id))
    .where(inArray(tables.policyScope.policyId, [...policyIds]))
    .orderBy(asc(tables.policyScope.createdAt));

  for (const row of rows) {
    const list = grouped.get(row.scope.policyId) ?? [];
    list.push(mapPolicyScope(row.scope, labelOf(row)));
    grouped.set(row.scope.policyId, list);
  }
  return grouped;
}

async function claimCounts(tx: Tx, policyIds: readonly string[]): Promise<Map<string, number>> {
  if (policyIds.length === 0) return new Map();
  const rows = await tx
    .select({ policyId: tables.claim.policyId, count: sql<number>`count(*)::int` })
    .from(tables.claim)
    .where(inArray(tables.claim.policyId, [...policyIds]))
    .groupBy(tables.claim.policyId);
  return new Map(rows.flatMap((row) => (row.policyId ? [[row.policyId, row.count]] : [])));
}

async function deadlinesOf(tx: Tx, policyId: string): Promise<PolicyDeadlineRow[]> {
  const rows = await tx
    .select({
      id: tables.deadline.id,
      title: tables.deadline.title,
      dueOn: tables.deadline.dueOn,
      status: tables.deadline.status,
    })
    .from(tables.deadline)
    .innerJoin(tables.deadlineLink, eq(tables.deadlineLink.deadlineId, tables.deadline.id))
    .innerJoin(tables.objectRef, eq(tables.deadlineLink.objectRefId, tables.objectRef.id))
    .where(eq(tables.objectRef.insurancePolicyId, policyId))
    .orderBy(asc(tables.deadline.dueOn));
  return rows;
}

async function policyIdsInScope(
  tx: Tx,
  filter: { buildingId?: string | undefined; unitId?: string | undefined },
): Promise<string[] | null> {
  const clauses = [
    filter.buildingId ? eq(tables.policyScope.buildingId, filter.buildingId) : undefined,
    filter.unitId ? eq(tables.policyScope.unitId, filter.unitId) : undefined,
  ].filter((clause) => clause !== undefined);
  if (clauses.length === 0) return null;
  const rows = await tx
    .selectDistinct({ policyId: tables.policyScope.policyId })
    .from(tables.policyScope)
    .where(and(...clauses));
  return rows.map((row) => row.policyId);
}

export async function listPolicies(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    kind?: string | undefined;
    status?: string | undefined;
    legalEntityId?: string | undefined;
    buildingId?: string | undefined;
    unitId?: string | undefined;
  },
): Promise<{ items: PolicyRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const scoped = await policyIdsInScope(tx, input);
  if (scoped !== null && scoped.length === 0) return { items: [], nextCursor: null };

  const filters = [
    input.kind ? eq(tables.insurancePolicy.kind, input.kind) : undefined,
    input.status ? eq(tables.insurancePolicy.status, input.status) : undefined,
    input.legalEntityId ? eq(tables.insurancePolicy.legalEntityId, input.legalEntityId) : undefined,
    scoped === null ? undefined : inArray(tables.insurancePolicy.id, scoped),
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select()
    .from(tables.insurancePolicy)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(tables.insurancePolicy.insurerName), asc(tables.insurancePolicy.policyNumber))
    .limit(limit + 1)
    .offset(offset);

  const page = rows.slice(0, limit);
  const ids = page.map((row) => row.id);
  const [scopes, claims] = await Promise.all([scopesByPolicy(tx, ids), claimCounts(tx, ids)]);
  const day = today();

  return {
    items: page.map((row) => ({
      ...mapPolicy(row),
      ...policyCertificate(row, day),
      scopeLabels: (scopes.get(row.id) ?? []).map((scope) => scope.label),
      claimCount: claims.get(row.id) ?? 0,
    })),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getPolicy(tx: Tx, id: string): Promise<PolicyDetail> {
  const row = firstOr(
    await tx
      .select()
      .from(tables.insurancePolicy)
      .where(eq(tables.insurancePolicy.id, id))
      .limit(1),
    "Police d’assurance",
  );
  const [scopes, claims, deadlines] = await Promise.all([
    scopesByPolicy(tx, [id]),
    claimCounts(tx, [id]),
    deadlinesOf(tx, id),
  ]);
  const entity = row.legalEntityId
    ? await tx
        .select({ name: tables.legalEntity.name })
        .from(tables.legalEntity)
        .where(eq(tables.legalEntity.id, row.legalEntityId))
        .limit(1)
    : [];
  const person = row.insuredPersonId
    ? await tx
        .select({ name: tables.person.displayName })
        .from(tables.person)
        .where(eq(tables.person.id, row.insuredPersonId))
        .limit(1)
    : [];
  const list = scopes.get(id) ?? [];

  return {
    ...mapPolicy(row),
    ...policyCertificate(row, today()),
    scopeLabels: list.map((scope) => scope.label),
    claimCount: claims.get(id) ?? 0,
    legalEntityName: entity[0]?.name ?? null,
    insuredPersonName: person[0]?.name ?? null,
    scopes: list,
    deadlines,
  };
}

/**
 * ASS-01 / TMP-04: one open renewal deadline per policy, moved when the cover
 * period moves. A second reminder is never a second obligation.
 */
export async function syncCertificateDeadline(
  tx: Tx,
  actor: Actor,
  policy: { id: string; endsOn: string | null; insurerName: string; policyNumber: string },
): Promise<string | null> {
  if (policy.endsOn === null) return null;
  const dueOn = certificateDueOn(policy.endsOn, today());
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "insurance_policy",
    id: policy.id,
  });

  const open = await tx
    .select({ id: tables.deadline.id, dueOn: tables.deadline.dueOn })
    .from(tables.deadline)
    .innerJoin(tables.deadlineLink, eq(tables.deadlineLink.deadlineId, tables.deadline.id))
    .where(
      and(
        eq(tables.deadlineLink.objectRefId, objectRefId),
        eq(tables.deadline.type, CERTIFICATE_DEADLINE_TYPE),
        inArray(tables.deadline.status, OPEN_DEADLINES),
      ),
    )
    .limit(1);

  const existing = open[0];
  if (!existing) {
    return planDeadline(tx, actor, {
      type: CERTIFICATE_DEADLINE_TYPE,
      title: `Attestation d’assurance : ${policy.insurerName} · ${policy.policyNumber}`,
      dueOn,
      priority: "high",
      objectRefId,
    });
  }
  if (existing.dueOn !== dueOn) {
    await tx
      .update(tables.deadline)
      .set({ dueOn, updatedAt: new Date().toISOString() })
      .where(eq(tables.deadline.id, existing.id));
    await tx
      .update(tables.deadlineLink)
      .set({ dueOn, updatedAt: new Date().toISOString() })
      .where(eq(tables.deadlineLink.deadlineId, existing.id));
  }
  return existing.id;
}

export async function createPolicy(
  tx: Tx,
  actor: Actor,
  input: CreatePolicyInput,
): Promise<PolicyDetail> {
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
    ruleViolation("La fin de garantie précède son début.");
  }
  const row = firstOr(
    await tx
      .insert(tables.insurancePolicy)
      .values({
        organizationId: actor.organizationId,
        kind: input.kind,
        insurerName: input.insurerName,
        policyNumber: input.policyNumber,
        legalEntityId: input.legalEntityId ?? null,
        insuredPersonId: input.insuredPersonId ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        premiumAmount: input.premiumAmount ?? null,
        premiumPeriodicity: input.premiumPeriodicity ?? null,
        deductibleAmount: input.deductibleAmount ?? null,
        guaranteesSummary: input.guaranteesSummary ?? null,
        exclusionsSummary: input.exclusionsSummary ?? null,
        status: "active",
      })
      .returning(),
    "Police d’assurance",
  );

  await recordFact(tx, actor, {
    kind: "insurance_policy",
    id: row.id,
    type: "insurance_policy.created",
    payload: { insurerName: row.insurerName, policyNumber: row.policyNumber },
  });
  await syncCertificateDeadline(tx, actor, row);
  await audit(tx, actor, {
    objectTable: "insurance_policy",
    objectId: row.id,
    action: "create",
    after: { insurerName: row.insurerName, policyNumber: row.policyNumber, kind: row.kind },
  });
  return getPolicy(tx, row.id);
}

export async function updatePolicy(
  tx: Tx,
  actor: Actor,
  input: UpdatePolicyInput,
): Promise<PolicyDetail> {
  const current = firstOr(
    await tx
      .select()
      .from(tables.insurancePolicy)
      .where(eq(tables.insurancePolicy.id, input.id))
      .limit(1),
    "Police d’assurance",
  );
  const startsOn = input.startsOn === undefined ? current.startsOn : input.startsOn;
  const endsOn = input.endsOn === undefined ? current.endsOn : input.endsOn;
  if (startsOn && endsOn && endsOn < startsOn) {
    ruleViolation("La fin de garantie précède son début.");
  }

  const patch = {
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.insurerName === undefined ? {} : { insurerName: input.insurerName }),
    ...(input.policyNumber === undefined ? {} : { policyNumber: input.policyNumber }),
    ...(input.legalEntityId === undefined ? {} : { legalEntityId: input.legalEntityId }),
    ...(input.insuredPersonId === undefined ? {} : { insuredPersonId: input.insuredPersonId }),
    ...(input.startsOn === undefined ? {} : { startsOn: input.startsOn }),
    ...(input.endsOn === undefined ? {} : { endsOn: input.endsOn }),
    ...(input.premiumAmount === undefined ? {} : { premiumAmount: input.premiumAmount }),
    ...(input.premiumPeriodicity === undefined
      ? {}
      : { premiumPeriodicity: input.premiumPeriodicity }),
    ...(input.deductibleAmount === undefined ? {} : { deductibleAmount: input.deductibleAmount }),
    ...(input.guaranteesSummary === undefined
      ? {}
      : { guaranteesSummary: input.guaranteesSummary }),
    ...(input.exclusionsSummary === undefined
      ? {}
      : { exclusionsSummary: input.exclusionsSummary }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };

  const updated = await tx
    .update(tables.insurancePolicy)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.insurancePolicy.id, input.id),
        eq(tables.insurancePolicy.version, input.expectedVersion),
      ),
    )
    .returning();
  const row = updated[0];
  if (!row) versionConflict("La police");

  await syncCertificateDeadline(tx, actor, row);
  await audit(tx, actor, {
    objectTable: "insurance_policy",
    objectId: input.id,
    action: input.status === undefined ? "update" : `update:${input.status}`,
    before: { status: current.status, endsOn: current.endsOn },
    after: patch,
  });
  return getPolicy(tx, input.id);
}

export async function addPolicyScope(
  tx: Tx,
  actor: Actor,
  input: AddPolicyScopeInput,
): Promise<PolicyDetail> {
  await getPolicy(tx, input.policyId);
  const column = {
    building: "buildingId",
    unit: "unitId",
    equipment: "equipmentId",
    lease: "leaseId",
    loan: "loanId",
  }[input.targetKind];

  await tx.insert(tables.policyScope).values({
    organizationId: actor.organizationId,
    policyId: input.policyId,
    [column]: input.targetId,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
  } as typeof tables.policyScope.$inferInsert);

  await audit(tx, actor, {
    objectTable: "policy_scope",
    objectId: input.policyId,
    action: "create",
    after: { targetKind: input.targetKind, targetId: input.targetId },
  });
  return getPolicy(tx, input.policyId);
}

export async function closePolicyScope(
  tx: Tx,
  actor: Actor,
  input: ClosePolicyScopeInput,
): Promise<PolicyDetail> {
  const updated = await tx
    .update(tables.policyScope)
    .set({
      endsOn: input.endsOn,
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(tables.policyScope.id, input.scopeId),
        eq(tables.policyScope.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated[0]) versionConflict("La couverture");

  await audit(tx, actor, {
    objectTable: "policy_scope",
    objectId: input.scopeId,
    action: "close",
    after: { endsOn: input.endsOn },
  });
  return getPolicy(tx, input.policyId);
}

/** ASS-01: a missing or expired certificate is an exception the owner can act on. */
export async function listPolicyExceptions(tx: Tx): Promise<{ items: PolicyExceptionRow[] }> {
  const rows = await tx
    .select()
    .from(tables.insurancePolicy)
    .where(notInArray(tables.insurancePolicy.status, ["cancelled", "draft"]))
    .orderBy(asc(tables.insurancePolicy.endsOn));
  const scopes = await scopesByPolicy(
    tx,
    rows.map((row) => row.id),
  );
  const day = today();

  return {
    items: rows
      .map((row) => ({ row, state: policyCertificate(row, day).certificateState }))
      .filter((entry) => isCertificateException(entry.state))
      .map((entry) => ({
        policyId: entry.row.id,
        label: `${entry.row.insurerName} · ${entry.row.policyNumber}`,
        insurerName: entry.row.insurerName,
        kind: entry.row.kind as PolicyExceptionRow["kind"],
        certificateState: entry.state,
        coverEndsOn: entry.row.endsOn,
        scopeLabels: (scopes.get(entry.row.id) ?? []).map((scope) => scope.label),
      })),
  };
}
