import "server-only";
import { ensureObjectRef, type Tx, tables } from "@lfsci/db";
import { type ClaimIndemnityInput, claimBalance } from "@lfsci/domain";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import type {
  ClaimBalanceView,
  ClaimDetail,
  ClaimExpenseRow,
  ClaimIndemnityRow,
  ClaimInterventionRow,
  ClaimRow,
  CreateClaimInput,
  LinkClaimInterventionInput,
  UpdateClaimInput,
} from "@/lib/contracts/assurances";
import { type Actor, audit, planDeadline, recordFact } from "../finance/facts";
import {
  amount,
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  offsetFromCursor,
  ruleViolation,
  versionConflict,
} from "../finance/shared";
import { mapClaim, mapIndemnity } from "./mappers";

export const CLAIM_DEADLINE_TYPE = "claim_deadline";
const OPEN_DEADLINES = ["planned", "to_process", "postponed", "blocked"];
const CLOSED_CLAIMS = ["settled", "closed", "refused"];
const COUNTED_EXPENSES = ["cancelled", "rejected"];

type ExpenseByClaim = Map<string, ClaimExpenseRow[]>;
type IndemnityByClaim = Map<string, ClaimIndemnityRow[]>;

/** The claim's expenses are the ones carried by the interventions attached to it. */
async function expensesByClaim(tx: Tx, claimIds: readonly string[]): Promise<ExpenseByClaim> {
  const grouped: ExpenseByClaim = new Map();
  if (claimIds.length === 0) return grouped;
  const rows = await tx
    .select({
      claimId: tables.intervention.claimId,
      interventionId: tables.intervention.id,
      interventionTitle: tables.intervention.title,
      id: tables.expense.id,
      issuedOn: tables.expense.issuedOn,
      totalInclTax: tables.expense.totalInclTax,
      currency: tables.expense.currency,
      status: tables.expense.status,
      supplierName: tables.supplier.name,
    })
    .from(tables.expense)
    .innerJoin(tables.intervention, eq(tables.expense.interventionId, tables.intervention.id))
    .leftJoin(tables.supplier, eq(tables.expense.supplierId, tables.supplier.id))
    .where(
      and(
        inArray(tables.intervention.claimId, [...claimIds]),
        notInArray(tables.expense.status, COUNTED_EXPENSES),
      ),
    )
    .orderBy(desc(tables.expense.issuedOn));

  for (const row of rows) {
    if (!row.claimId) continue;
    const list = grouped.get(row.claimId) ?? [];
    list.push({
      id: row.id,
      interventionId: row.interventionId,
      interventionTitle: row.interventionTitle,
      supplierName: row.supplierName,
      issuedOn: row.issuedOn,
      totalInclTax: amount(row.totalInclTax),
      currency: row.currency,
      status: row.status,
    });
    grouped.set(row.claimId, list);
  }
  return grouped;
}

/**
 * SIN-01: an indemnity is cash, and its authority is the accounting ledger.
 * These rows are read; the application never invents one.
 */
async function indemnitiesByClaim(tx: Tx, claimIds: readonly string[]): Promise<IndemnityByClaim> {
  const grouped: IndemnityByClaim = new Map();
  if (claimIds.length === 0) return grouped;
  const rows = await tx
    .select({
      indemnity: tables.claimIndemnity,
      paymentLabel: tables.payment.payerLabel,
      paymentReceivedOn: tables.payment.receivedOn,
    })
    .from(tables.claimIndemnity)
    .leftJoin(tables.payment, eq(tables.claimIndemnity.paymentId, tables.payment.id))
    .where(inArray(tables.claimIndemnity.claimId, [...claimIds]))
    .orderBy(asc(tables.claimIndemnity.receivedOn));

  for (const row of rows) {
    const list = grouped.get(row.indemnity.claimId) ?? [];
    list.push(
      mapIndemnity(
        row.indemnity,
        row.paymentLabel ??
          (row.paymentReceivedOn ? `Encaissement ${row.paymentReceivedOn}` : null),
      ),
    );
    grouped.set(row.indemnity.claimId, list);
  }
  return grouped;
}

function balanceOf(
  claim: { deductibleApplied: string | null; indemnityExpected: string | null },
  expenses: readonly ClaimExpenseRow[],
  indemnities: readonly ClaimIndemnityRow[],
): ClaimBalanceView {
  const lines: ClaimIndemnityInput[] = indemnities.map((row) => ({
    id: row.id,
    amount: row.amount,
    kind: row.kind,
  }));
  return claimBalance({
    expenses: expenses.map((row) => ({ id: row.id, amount: row.totalInclTax })),
    indemnities: lines,
    deductibleApplied: claim.deductibleApplied,
    indemnityExpected: claim.indemnityExpected,
  });
}

async function labelsOf(
  tx: Tx,
  claim: { policyId: string | null; unitId: string | null; buildingId: string | null },
): Promise<{ policyLabel: string | null; unitLabel: string | null; buildingLabel: string | null }> {
  const policy = claim.policyId
    ? await tx
        .select({
          insurerName: tables.insurancePolicy.insurerName,
          policyNumber: tables.insurancePolicy.policyNumber,
        })
        .from(tables.insurancePolicy)
        .where(eq(tables.insurancePolicy.id, claim.policyId))
        .limit(1)
    : [];
  const unit = claim.unitId
    ? await tx
        .select({ code: tables.unit.code, label: tables.unit.label })
        .from(tables.unit)
        .where(eq(tables.unit.id, claim.unitId))
        .limit(1)
    : [];
  const building = claim.buildingId
    ? await tx
        .select({ name: tables.building.name })
        .from(tables.building)
        .where(eq(tables.building.id, claim.buildingId))
        .limit(1)
    : [];
  const first = policy[0];
  const unitRow = unit[0];
  return {
    policyLabel: first ? `${first.insurerName} · ${first.policyNumber}` : null,
    unitLabel: unitRow ? [unitRow.code, unitRow.label].filter((part) => part).join(" — ") : null,
    buildingLabel: building[0]?.name ?? null,
  };
}

export async function listClaims(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    status?: string | undefined;
    policyId?: string | undefined;
    unitId?: string | undefined;
    openOnly?: boolean | undefined;
  },
): Promise<{ items: ClaimRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.status ? eq(tables.claim.status, input.status) : undefined,
    input.policyId ? eq(tables.claim.policyId, input.policyId) : undefined,
    input.unitId ? eq(tables.claim.unitId, input.unitId) : undefined,
    input.openOnly ? notInArray(tables.claim.status, CLOSED_CLAIMS) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select()
    .from(tables.claim)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.claim.occurredOn), desc(tables.claim.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const page = rows.slice(0, limit);
  const ids = page.map((row) => row.id);
  const [expenses, indemnities] = await Promise.all([
    expensesByClaim(tx, ids),
    indemnitiesByClaim(tx, ids),
  ]);

  const items: ClaimRow[] = [];
  for (const row of page) {
    const claim = mapClaim(row);
    items.push({
      ...claim,
      ...(await labelsOf(tx, claim)),
      balance: balanceOf(claim, expenses.get(row.id) ?? [], indemnities.get(row.id) ?? []),
    });
  }
  return { items, nextCursor: nextCursor(offset, limit, rows.length) };
}

export async function getClaim(tx: Tx, id: string): Promise<ClaimDetail> {
  const row = firstOr(
    await tx.select().from(tables.claim).where(eq(tables.claim.id, id)).limit(1),
    "Sinistre",
  );
  const claim = mapClaim(row);
  const [expenses, indemnities, interventions, labels] = await Promise.all([
    expensesByClaim(tx, [id]),
    indemnitiesByClaim(tx, [id]),
    tx
      .select({
        id: tables.intervention.id,
        version: tables.intervention.version,
        title: tables.intervention.title,
        status: tables.intervention.status,
        unitId: tables.intervention.unitId,
        completedOn: tables.intervention.completedOn,
      })
      .from(tables.intervention)
      .where(eq(tables.intervention.claimId, id))
      .orderBy(asc(tables.intervention.createdAt)),
    labelsOf(tx, claim),
  ]);

  const claimExpenses = expenses.get(id) ?? [];
  const claimIndemnities = indemnities.get(id) ?? [];
  return {
    ...claim,
    ...labels,
    balance: balanceOf(claim, claimExpenses, claimIndemnities),
    expenses: claimExpenses,
    interventions: interventions as ClaimInterventionRow[],
    indemnities: claimIndemnities,
  };
}

/** SIN-01: the declaration deadline is one obligation, moved rather than duplicated. */
async function syncClaimDeadline(
  tx: Tx,
  actor: Actor,
  claim: { id: string; deadlineOn: string | null; reference: string | null },
): Promise<void> {
  if (claim.deadlineOn === null) return;
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "claim",
    id: claim.id,
  });
  const open = await tx
    .select({ id: tables.deadline.id, dueOn: tables.deadline.dueOn })
    .from(tables.deadline)
    .innerJoin(tables.deadlineLink, eq(tables.deadlineLink.deadlineId, tables.deadline.id))
    .where(
      and(
        eq(tables.deadlineLink.objectRefId, objectRefId),
        eq(tables.deadline.type, CLAIM_DEADLINE_TYPE),
        inArray(tables.deadline.status, OPEN_DEADLINES),
      ),
    )
    .limit(1);

  const existing = open[0];
  if (!existing) {
    await planDeadline(tx, actor, {
      type: CLAIM_DEADLINE_TYPE,
      title: `Sinistre : ${claim.reference ?? claim.id.slice(0, 8)}`,
      dueOn: claim.deadlineOn,
      priority: "high",
      objectRefId,
    });
    return;
  }
  if (existing.dueOn !== claim.deadlineOn) {
    const now = new Date().toISOString();
    await tx
      .update(tables.deadline)
      .set({ dueOn: claim.deadlineOn, updatedAt: now })
      .where(eq(tables.deadline.id, existing.id));
    await tx
      .update(tables.deadlineLink)
      .set({ dueOn: claim.deadlineOn, updatedAt: now })
      .where(eq(tables.deadlineLink.deadlineId, existing.id));
  }
}

export async function createClaim(
  tx: Tx,
  actor: Actor,
  input: CreateClaimInput,
): Promise<ClaimDetail> {
  if (input.occurredOn && input.declaredOn && input.declaredOn < input.occurredOn) {
    ruleViolation("Une déclaration ne peut pas précéder les faits.");
  }
  const row = firstOr(
    await tx
      .insert(tables.claim)
      .values({
        organizationId: actor.organizationId,
        policyId: input.policyId ?? null,
        buildingId: input.buildingId ?? null,
        unitId: input.unitId ?? null,
        leaseId: input.leaseId ?? null,
        reference: input.reference ?? null,
        insurerClaimNumber: input.insurerClaimNumber ?? null,
        occurredOn: input.occurredOn ?? null,
        declaredOn: input.declaredOn ?? null,
        facts: input.facts ?? null,
        allegedLiability: input.allegedLiability ?? null,
        estimatedDamage: input.estimatedDamage ?? null,
        deadlineOn: input.deadlineOn ?? null,
        status: input.declaredOn ? "declared" : "draft",
      })
      .returning(),
    "Sinistre",
  );

  await recordFact(tx, actor, {
    kind: "claim",
    id: row.id,
    type: "claim.declared",
    payload: { reference: row.reference, occurredOn: row.occurredOn },
    ...(row.declaredOn ? { occurredAt: `${row.declaredOn}T12:00:00.000Z` } : {}),
  });
  await syncClaimDeadline(tx, actor, row);
  await audit(tx, actor, {
    objectTable: "claim",
    objectId: row.id,
    action: "create",
    after: { reference: row.reference, status: row.status },
  });
  return getClaim(tx, row.id);
}

export async function updateClaim(
  tx: Tx,
  actor: Actor,
  input: UpdateClaimInput,
): Promise<ClaimDetail> {
  const current = firstOr(
    await tx.select().from(tables.claim).where(eq(tables.claim.id, input.id)).limit(1),
    "Sinistre",
  );
  const occurredOn = input.occurredOn === undefined ? current.occurredOn : input.occurredOn;
  const declaredOn = input.declaredOn === undefined ? current.declaredOn : input.declaredOn;
  if (occurredOn && declaredOn && declaredOn < occurredOn) {
    ruleViolation("Une déclaration ne peut pas précéder les faits.");
  }

  const patch = {
    ...(input.policyId === undefined ? {} : { policyId: input.policyId }),
    ...(input.buildingId === undefined ? {} : { buildingId: input.buildingId }),
    ...(input.unitId === undefined ? {} : { unitId: input.unitId }),
    ...(input.reference === undefined ? {} : { reference: input.reference }),
    ...(input.insurerClaimNumber === undefined
      ? {}
      : { insurerClaimNumber: input.insurerClaimNumber }),
    ...(input.occurredOn === undefined ? {} : { occurredOn: input.occurredOn }),
    ...(input.declaredOn === undefined ? {} : { declaredOn: input.declaredOn }),
    ...(input.facts === undefined ? {} : { facts: input.facts }),
    ...(input.allegedLiability === undefined ? {} : { allegedLiability: input.allegedLiability }),
    ...(input.acknowledgedLiability === undefined
      ? {}
      : { acknowledgedLiability: input.acknowledgedLiability }),
    ...(input.expertName === undefined ? {} : { expertName: input.expertName }),
    ...(input.expertVisitOn === undefined ? {} : { expertVisitOn: input.expertVisitOn }),
    ...(input.estimatedDamage === undefined ? {} : { estimatedDamage: input.estimatedDamage }),
    ...(input.indemnityExpected === undefined
      ? {}
      : { indemnityExpected: input.indemnityExpected }),
    ...(input.deductibleApplied === undefined
      ? {}
      : { deductibleApplied: input.deductibleApplied }),
    ...(input.deadlineOn === undefined ? {} : { deadlineOn: input.deadlineOn }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };

  const updated = await tx
    .update(tables.claim)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(and(eq(tables.claim.id, input.id), eq(tables.claim.version, input.expectedVersion)))
    .returning();
  const row = updated[0];
  if (!row) versionConflict("Le sinistre");

  if (input.status !== undefined && input.status !== current.status) {
    await recordFact(tx, actor, {
      kind: "claim",
      id: row.id,
      type: `claim.${input.status}`,
      payload: { from: current.status, to: input.status },
    });
  }
  await syncClaimDeadline(tx, actor, row);
  await audit(tx, actor, {
    objectTable: "claim",
    objectId: input.id,
    action: input.status === undefined ? "update" : `transition:${input.status}`,
    before: { status: current.status },
    after: patch,
  });
  return getClaim(tx, input.id);
}

/**
 * The only link between a claim and its expenses is the intervention, so
 * attaching an expense to a claim means attaching the intervention that carries
 * it.
 */
export async function linkClaimIntervention(
  tx: Tx,
  actor: Actor,
  input: LinkClaimInterventionInput,
): Promise<ClaimDetail> {
  const intervention = firstOr(
    await tx
      .select()
      .from(tables.intervention)
      .where(eq(tables.intervention.id, input.interventionId))
      .limit(1),
    "Intervention",
  );
  if (intervention.version !== input.expectedVersion) versionConflict("L’intervention");
  if (input.attached && intervention.claimId && intervention.claimId !== input.claimId) {
    ruleViolation("Cette intervention est déjà rattachée à un autre sinistre.");
  }

  const updated = await tx
    .update(tables.intervention)
    .set({
      claimId: input.attached ? input.claimId : null,
      version: intervention.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(tables.intervention.id, input.interventionId),
        eq(tables.intervention.version, intervention.version),
      ),
    )
    .returning({ id: tables.intervention.id });
  if (!updated[0]) versionConflict("L’intervention");

  await audit(tx, actor, {
    objectTable: "intervention",
    objectId: input.interventionId,
    action: input.attached ? "claim.link" : "claim.unlink",
    before: { claimId: intervention.claimId },
    after: { claimId: input.attached ? input.claimId : null },
  });
  return getClaim(tx, input.claimId);
}
