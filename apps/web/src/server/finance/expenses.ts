import "server-only";
import type { Expense, Supplier } from "@lfsci/contracts";
import { resolveDecisionLevel } from "@lfsci/contracts";
import { createCommand, ensureObjectRef, hashPayload, type Tx, tables } from "@lfsci/db";
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type {
  AllocateExpenseInput,
  CaptureExpenseWithLinesInput,
  CreateSupplierInput,
  ValidateExpenseResult,
} from "@/lib/contracts/finance";
import { planAllocation } from "./allocation";
import { type Actor, audit, recordFact } from "./facts";
import { mapExpense, mapSupplier } from "./mappers";
import {
  amount,
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  notFound,
  offsetFromCursor,
  ruleViolation,
  sumAmounts,
  versionConflict,
} from "./shared";

export type ListExpensesInput = {
  cursor?: string | undefined;
  limit?: number | undefined;
  legalEntityId?: string | undefined;
  supplierId?: string | undefined;
  status?: string | undefined;
  issuedFrom?: string | undefined;
  issuedTo?: string | undefined;
  search?: string | undefined;
};

async function readExpense(tx: Tx, id: string): Promise<Expense> {
  const rows = await tx.select().from(tables.expense).where(eq(tables.expense.id, id)).limit(1);
  const row = firstOr(rows, "Dépense");
  const lines = await tx
    .select()
    .from(tables.expenseLine)
    .where(eq(tables.expenseLine.expenseId, id))
    .orderBy(asc(tables.expenseLine.lineNumber));
  const allocations =
    lines.length === 0
      ? []
      : await tx
          .select()
          .from(tables.expenseAllocation)
          .where(
            inArray(
              tables.expenseAllocation.expenseLineId,
              lines.map((line) => line.id),
            ),
          );
  return mapExpense(row, lines, allocations);
}

export async function listExpenses(tx: Tx, input: ListExpensesInput) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.legalEntityId ? eq(tables.expense.legalEntityId, input.legalEntityId) : undefined,
    input.supplierId ? eq(tables.expense.supplierId, input.supplierId) : undefined,
    input.status ? eq(tables.expense.status, input.status) : undefined,
    input.issuedFrom ? gte(tables.expense.issuedOn, input.issuedFrom) : undefined,
    input.issuedTo ? lte(tables.expense.issuedOn, input.issuedTo) : undefined,
    input.search ? ilike(tables.expense.supplierReference, `%${input.search}%`) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select()
    .from(tables.expense)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.expense.issuedOn), desc(tables.expense.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const page = rows.slice(0, limit);
  const lines =
    page.length === 0
      ? []
      : await tx
          .select()
          .from(tables.expenseLine)
          .where(
            inArray(
              tables.expenseLine.expenseId,
              page.map((row) => row.id),
            ),
          );
  const allocations =
    lines.length === 0
      ? []
      : await tx
          .select()
          .from(tables.expenseAllocation)
          .where(
            inArray(
              tables.expenseAllocation.expenseLineId,
              lines.map((line) => line.id),
            ),
          );

  return {
    items: page.map((row) =>
      mapExpense(
        row,
        lines.filter((line) => line.expenseId === row.id),
        allocations,
      ),
    ),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getExpense(tx: Tx, id: string): Promise<Expense> {
  return readExpense(tx, id);
}

async function resolveSupplier(
  tx: Tx,
  actor: Actor,
  input: { supplierId?: string | undefined; supplierName?: string | undefined },
): Promise<string | null> {
  if (input.supplierId) {
    const rows = await tx
      .select({ id: tables.supplier.id })
      .from(tables.supplier)
      .where(eq(tables.supplier.id, input.supplierId))
      .limit(1);
    if (!rows[0]) notFound("Fournisseur");
    return input.supplierId;
  }
  if (!input.supplierName) return null;
  const existing = await tx
    .select({ id: tables.supplier.id })
    .from(tables.supplier)
    .where(ilike(tables.supplier.name, input.supplierName))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const created = await createSupplier(tx, actor, { name: input.supplierName });
  return created.id;
}

/** DEP-01/DEP-02: one capture, from the form or from an already stored document. */
export async function captureExpense(
  tx: Tx,
  actor: Actor,
  input: CaptureExpenseWithLinesInput,
): Promise<Expense> {
  if (input.payer === "partner" && !input.paidByPersonId) {
    ruleViolation("Un achat payé personnellement exige l’associé payeur (CCA-02).");
  }
  const supplierId = await resolveSupplier(tx, actor, {
    supplierId: input.supplierId,
    supplierName: input.supplierName,
  });

  const inserted = await tx
    .insert(tables.expense)
    .values({
      organizationId: actor.organizationId,
      legalEntityId: input.legalEntityId,
      supplierId,
      documentKind: input.documentKind,
      supplierReference: input.supplierReference ?? null,
      issuedOn: input.issuedOn ?? null,
      totalExclTax: input.totalExclTax ?? null,
      taxAmount: input.taxAmount ?? null,
      totalInclTax: input.totalInclTax,
      worksProjectId: input.worksProjectId ?? null,
      interventionId: input.interventionId ?? null,
      payer: input.payer ?? "entity",
      paidByPersonId: input.paidByPersonId ?? null,
      status: "captured",
    })
    .returning();
  const row = firstOr(inserted, "Dépense");

  const lines = input.lines ?? [
    { description: "Montant total", amountInclTax: input.totalInclTax, recoverableShare: "0" },
  ];
  const linesTotal = sumAmounts(lines.map((line) => line.amountInclTax));
  if (linesTotal !== amount(input.totalInclTax)) {
    ruleViolation("Le total des lignes doit égaler le total de la dépense (DEP-01).", {
      lignes: linesTotal,
      total: amount(input.totalInclTax),
    });
  }

  await tx.insert(tables.expenseLine).values(
    lines.map((line, index) => ({
      organizationId: actor.organizationId,
      expenseId: row.id,
      lineNumber: index + 1,
      description: line.description,
      amountInclTax: line.amountInclTax,
      chargeNature: line.chargeNature ?? null,
      recoverableShare: line.recoverableShare ?? "0",
      unallocatedAmount: line.amountInclTax,
    })),
  );

  const { objectRefId } = await recordFact(tx, actor, {
    kind: "expense",
    id: row.id,
    type: "expense.captured",
    payload: { totalInclTax: amount(row.totalInclTax), payer: row.payer },
  });

  if (input.documentId) {
    await tx
      .insert(tables.documentLink)
      .values({
        organizationId: actor.organizationId,
        documentId: input.documentId,
        objectRefId,
        relation: "invoice",
      })
      .onConflictDoNothing();
  }

  await audit(tx, actor, {
    objectTable: "expense",
    objectId: row.id,
    objectRefId,
    action: "capture",
    after: { totalInclTax: amount(row.totalInclTax), status: row.status },
  });

  return readExpense(tx, row.id);
}

export async function updateExpense(
  tx: Tx,
  actor: Actor,
  input: {
    id: string;
    expectedVersion: number;
    supplierId?: string | null | undefined;
    issuedOn?: string | null | undefined;
    totalExclTax?: string | null | undefined;
    taxAmount?: string | null | undefined;
    totalInclTax?: string | undefined;
    payer?: Expense["payer"] | undefined;
    paidByPersonId?: string | null | undefined;
    status?: Expense["status"] | undefined;
  },
): Promise<Expense> {
  const patch = {
    ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
    ...(input.issuedOn === undefined ? {} : { issuedOn: input.issuedOn }),
    ...(input.totalExclTax === undefined ? {} : { totalExclTax: input.totalExclTax }),
    ...(input.taxAmount === undefined ? {} : { taxAmount: input.taxAmount }),
    ...(input.totalInclTax === undefined ? {} : { totalInclTax: input.totalInclTax }),
    ...(input.payer === undefined ? {} : { payer: input.payer }),
    ...(input.paidByPersonId === undefined ? {} : { paidByPersonId: input.paidByPersonId }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
  const updated = await tx
    .update(tables.expense)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(and(eq(tables.expense.id, input.id), eq(tables.expense.version, input.expectedVersion)))
    .returning();
  if (!updated[0]) versionConflict("La dépense");
  await audit(tx, actor, {
    objectTable: "expense",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return readExpense(tx, input.id);
}

/**
 * CHA-01 / F05: every allocation of the expense is rewritten in this one
 * transaction with each line's residual, so the DEFERRED balance trigger sees
 * a consistent state at commit and never an intermediate one.
 */
export async function allocateExpense(
  tx: Tx,
  actor: Actor,
  input: AllocateExpenseInput,
): Promise<Expense> {
  const expenseRows = await tx
    .select()
    .from(tables.expense)
    .where(eq(tables.expense.id, input.id))
    .limit(1);
  const expense = firstOr(expenseRows, "Dépense");
  if (expense.version !== input.expectedVersion) versionConflict("La dépense");

  const lineRows = await tx
    .select()
    .from(tables.expenseLine)
    .where(eq(tables.expenseLine.expenseId, input.id));

  const plan = planAllocation(
    input,
    lineRows.map((line) => ({
      lineNumber: line.lineNumber,
      amountInclTax: amount(line.amountInclTax),
      recoverableShare: line.recoverableShare,
    })),
  );

  const byNumber = new Map(lineRows.map((line) => [line.lineNumber, line]));
  await tx.delete(tables.expenseAllocation).where(
    inArray(
      tables.expenseAllocation.expenseLineId,
      lineRows.map((line) => line.id),
    ),
  );

  for (const line of plan.lines) {
    const target = byNumber.get(line.lineNumber);
    if (!target) notFound("Ligne de dépense");
    await tx
      .update(tables.expenseLine)
      .set({
        unallocatedAmount: line.unallocatedAmount,
        recoverableShare: line.recoverableShare,
        version: target.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tables.expenseLine.id, target.id));
    await tx.insert(tables.expenseAllocation).values(
      line.allocations.map((allocation) => ({
        organizationId: actor.organizationId,
        expenseLineId: target.id,
        target: allocation.target,
        unitId: allocation.unitId,
        buildingId: allocation.buildingId,
        legalEntityId: allocation.legalEntityId,
        amount: allocation.amount,
        currency: target.currency,
        recoverableAmount: allocation.recoverableAmount,
      })),
    );
  }

  await tx
    .update(tables.expense)
    .set({
      status: expense.status === "captured" ? "to_review" : expense.status,
      version: expense.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tables.expense.id, input.id));

  await audit(tx, actor, {
    objectTable: "expense",
    objectId: input.id,
    action: "allocate",
    after: { totalAllocated: plan.totalAllocated, totalUnallocated: plan.totalUnallocated },
  });

  return readExpense(tx, input.id);
}

/**
 * DEP-02 / ARC-02: validation prepares the accounting command and stops there.
 * A new supplier or a partner payer raises the decision to D; nothing is
 * enqueued here — the approval flow authorises the command.
 */
export async function validateExpense(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number },
): Promise<ValidateExpenseResult> {
  const rows = await tx
    .select()
    .from(tables.expense)
    .where(eq(tables.expense.id, input.id))
    .limit(1);
  const expense = firstOr(rows, "Dépense");
  if (expense.version !== input.expectedVersion) versionConflict("La dépense");
  if (!expense.supplierId) ruleViolation("La dépense doit porter un fournisseur avant validation.");
  if (!expense.issuedOn) ruleViolation("La dépense doit porter sa date d’émission.");
  if (!expense.supplierReference) {
    ruleViolation("La dépense doit porter la référence du fournisseur.");
  }

  const supplier = firstOr(
    await tx
      .select()
      .from(tables.supplier)
      .where(eq(tables.supplier.id, expense.supplierId))
      .limit(1),
    "Fournisseur",
  );

  const unallocated = await tx
    .select({ total: sql<string>`coalesce(sum(${tables.expenseLine.unallocatedAmount}), 0)` })
    .from(tables.expenseLine)
    .where(eq(tables.expenseLine.expenseId, input.id));
  const residual = amount(unallocated[0]?.total);
  if (residual !== "0.00") {
    ruleViolation(
      `Il reste ${residual} € non affectés : ventilez la dépense ou assumez le résidu (CHA-01).`,
    );
  }

  const isNewSupplier = supplier.paymentIdentityValidatedAt === null;
  const payerIsPartner = expense.payer === "partner";
  const decisionLevel = payerIsPartner
    ? "D"
    : resolveDecisionLevel("post_supplier_bill", { isNewSupplier });

  const payload = {
    expenseId: expense.id,
    supplierId: supplier.id,
    supplierReference: expense.supplierReference,
    issuedOn: expense.issuedOn,
    totalExclTax: amount(expense.totalExclTax, amount(expense.totalInclTax)),
    taxAmount: amount(expense.taxAmount),
    totalInclTax: amount(expense.totalInclTax),
    currency: expense.currency,
    isNewSupplier,
    paymentIdentityChanged: false,
  };

  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "expense",
    id: expense.id,
  });

  const command = await createCommand(tx, {
    organizationId: actor.organizationId,
    commandType: "post_supplier_bill",
    operationKey: `post_supplier_bill:${expense.id}:v${expense.version}`,
    payload,
    payloadHash: hashPayload(payload),
    targetObjectRefId: objectRefId,
    expectedVersion: expense.version,
    actorUserId: actor.actorUserId,
    autonomyLevel: decisionLevel,
    status: "prepared",
  });

  await tx
    .update(tables.expense)
    .set({
      status: "validated",
      version: expense.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(tables.expense.id, expense.id), eq(tables.expense.version, expense.version)));

  await recordFact(tx, actor, {
    kind: "expense",
    id: expense.id,
    type: "expense.validated",
    payload: { commandId: command.id, decisionLevel },
  });
  await audit(tx, actor, {
    objectTable: "expense",
    objectId: expense.id,
    objectRefId,
    action: "validate",
    before: { status: expense.status },
    after: { status: "validated", commandId: command.id, decisionLevel },
  });

  return {
    expense: await readExpense(tx, expense.id),
    commandId: command.id,
    commandStatus: command.status,
    decisionLevel,
    isNewSupplier,
    payerIsPartner,
  };
}

export async function listSuppliers(
  tx: Tx,
  input: { cursor?: string | undefined; limit?: number | undefined; search?: string | undefined },
) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const rows = await tx
    .select()
    .from(tables.supplier)
    .where(input.search ? ilike(tables.supplier.name, `%${input.search}%`) : undefined)
    .orderBy(asc(tables.supplier.name))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map(mapSupplier),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

/** DEP-02: a supplier created here is `proposed`; its payment identity is validated apart. */
export async function createSupplier(
  tx: Tx,
  actor: Actor,
  input: CreateSupplierInput,
): Promise<Supplier> {
  const inserted = await tx
    .insert(tables.supplier)
    .values({
      organizationId: actor.organizationId,
      name: input.name,
      trade: input.trade ?? null,
      siren: input.siren ?? null,
      status: "proposed",
    })
    .returning();
  const row = firstOr(inserted, "Fournisseur");
  await audit(tx, actor, {
    objectTable: "supplier",
    objectId: row.id,
    action: "create",
    after: { name: row.name, status: row.status },
  });
  return mapSupplier(row);
}
