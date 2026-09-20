import "server-only";
import type { WorksProject } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { decimal, toMoney } from "@lfsci/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  CreateWorksProjectInput,
  UpdateWorksProjectInput,
  WorksProjectBudget,
  WorksProjectDetail,
  WorksProjectRow,
} from "@/lib/contracts/travaux";
import { type Actor, audit } from "../finance/facts";
import {
  amount,
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  offsetFromCursor,
  sumAmounts,
  versionConflict,
} from "../finance/shared";
import { mapWorksProject } from "./mappers";

const INVOICED = ["validated", "posted", "paid", "reconciled"];
const PAID = ["paid", "reconciled"];

type ExpenseTotals = { engaged: string; invoiced: string; paid: string; expenseCount: number };

/** TRA-01: engaged, invoiced and paid come from the expenses linked to the project. */
async function totalsByProject(
  tx: Tx,
  projectIds: readonly string[],
): Promise<Map<string, ExpenseTotals>> {
  const totals = new Map<string, ExpenseTotals>();
  if (projectIds.length === 0) return totals;
  const rows = await tx
    .select({
      worksProjectId: tables.expense.worksProjectId,
      status: tables.expense.status,
      total: sql<string>`sum(${tables.expense.totalInclTax})`,
      count: sql<number>`count(*)::int`,
    })
    .from(tables.expense)
    .where(
      and(
        inArray(tables.expense.worksProjectId, [...projectIds]),
        sql`${tables.expense.status} NOT IN ('cancelled', 'rejected')`,
      ),
    )
    .groupBy(tables.expense.worksProjectId, tables.expense.status);

  for (const row of rows) {
    if (!row.worksProjectId) continue;
    const current = totals.get(row.worksProjectId) ?? {
      engaged: "0.00",
      invoiced: "0.00",
      paid: "0.00",
      expenseCount: 0,
    };
    const value = amount(row.total);
    current.engaged = sumAmounts([current.engaged, value]);
    if (INVOICED.includes(row.status)) current.invoiced = sumAmounts([current.invoiced, value]);
    if (PAID.includes(row.status)) current.paid = sumAmounts([current.paid, value]);
    current.expenseCount += row.count;
    totals.set(row.worksProjectId, current);
  }
  return totals;
}

function budgetOf(
  budgetAmount: string | null,
  totals: ExpenseTotals | undefined,
): WorksProjectBudget {
  const engaged = totals?.engaged ?? "0.00";
  return {
    budget: budgetAmount,
    engaged,
    invoiced: totals?.invoiced ?? "0.00",
    paid: totals?.paid ?? "0.00",
    remaining:
      budgetAmount === null ? null : toMoney(decimal(budgetAmount).minus(decimal(engaged))),
    expenseCount: totals?.expenseCount ?? 0,
  };
}

export async function listProjects(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    legalEntityId?: string | undefined;
    buildingId?: string | undefined;
    status?: string | undefined;
  },
): Promise<{ items: WorksProjectRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.legalEntityId ? eq(tables.worksProject.legalEntityId, input.legalEntityId) : undefined,
    input.buildingId ? eq(tables.worksProject.buildingId, input.buildingId) : undefined,
    input.status ? eq(tables.worksProject.status, input.status) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select()
    .from(tables.worksProject)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(tables.worksProject.label))
    .limit(limit + 1)
    .offset(offset);
  const page = rows.slice(0, limit);
  const totals = await totalsByProject(
    tx,
    page.map((row) => row.id),
  );

  return {
    items: page.map((row) => ({
      ...mapWorksProject(row),
      budgetTracking: budgetOf(amount(row.budgetAmount, "0.00"), totals.get(row.id)),
    })),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getProject(tx: Tx, id: string): Promise<WorksProjectDetail> {
  const row = firstOr(
    await tx.select().from(tables.worksProject).where(eq(tables.worksProject.id, id)).limit(1),
    "Projet de travaux",
  );
  const totals = await totalsByProject(tx, [id]);
  const interventions = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tables.intervention)
    .where(eq(tables.intervention.worksProjectId, id));
  const project = mapWorksProject(row);
  return {
    ...project,
    budgetTracking: budgetOf(project.budgetAmount, totals.get(id)),
    interventionCount: interventions[0]?.count ?? 0,
  };
}

export async function createProject(
  tx: Tx,
  actor: Actor,
  input: CreateWorksProjectInput,
): Promise<WorksProject> {
  const row = firstOr(
    await tx
      .insert(tables.worksProject)
      .values({
        organizationId: actor.organizationId,
        legalEntityId: input.legalEntityId,
        buildingId: input.buildingId ?? null,
        unitId: input.unitId ?? null,
        label: input.label,
        nature: input.nature ?? "to_qualify",
        // TRA-01: the business nature never decides expense versus capitalization.
        accountingTreatment: input.accountingTreatment ?? "to_qualify",
        budgetAmount: input.budgetAmount ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        status: "draft",
      })
      .returning(),
    "Projet de travaux",
  );
  await audit(tx, actor, {
    objectTable: "works_project",
    objectId: row.id,
    action: "create",
    after: { label: row.label, budgetAmount: row.budgetAmount },
  });
  return mapWorksProject(row);
}

export async function updateProject(
  tx: Tx,
  actor: Actor,
  input: UpdateWorksProjectInput,
): Promise<WorksProject> {
  const patch = {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.nature === undefined ? {} : { nature: input.nature }),
    ...(input.accountingTreatment === undefined
      ? {}
      : { accountingTreatment: input.accountingTreatment }),
    ...(input.budgetAmount === undefined ? {} : { budgetAmount: input.budgetAmount }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.startsOn === undefined ? {} : { startsOn: input.startsOn }),
    ...(input.endsOn === undefined ? {} : { endsOn: input.endsOn }),
  };
  const updated = await tx
    .update(tables.worksProject)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.worksProject.id, input.id),
        eq(tables.worksProject.version, input.expectedVersion),
      ),
    )
    .returning();
  const row = updated[0];
  if (!row) versionConflict("Le projet");
  await audit(tx, actor, {
    objectTable: "works_project",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return mapWorksProject(row);
}
