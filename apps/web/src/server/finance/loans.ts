import "server-only";
import type { Loan, UpdateLoanInput } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { buildSchedule, decimal, insuranceBasisOf, scheduleProgress, toMoney } from "@lfsci/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  CreateLoanWithScheduleInput,
  LinkLoanPropertyInput,
  LoanPropertyLink,
  LoanSchedule,
} from "@/lib/contracts/finance";
import { type Actor, audit, recordFact } from "./facts";
import { mapInstallment, mapLoan, withDebitMatch } from "./mappers";
import {
  amount,
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  offsetFromCursor,
  ruleViolation,
  sumAmounts,
  today,
  versionConflict,
} from "./shared";

// loan.nominal_rate / insurance_rate are stored as percentages; the domain
// schedule takes an annual fraction, and the insurance premium is read as an
// annual rate on the released principal.
function asFraction(percent: string | null): string {
  return percent === null ? "0" : decimal(percent).dividedBy(100).toFixed(12);
}

export async function listLoans(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    legalEntityId?: string | undefined;
    status?: string | undefined;
  },
) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.legalEntityId ? eq(tables.loan.legalEntityId, input.legalEntityId) : undefined,
    input.status ? eq(tables.loan.status, input.status) : undefined,
  ].filter((clause) => clause !== undefined);
  const rows = await tx
    .select()
    .from(tables.loan)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(tables.loan.lenderName), asc(tables.loan.reference))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map(mapLoan),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getLoan(tx: Tx, id: string): Promise<Loan> {
  const rows = await tx.select().from(tables.loan).where(eq(tables.loan.id, id)).limit(1);
  return mapLoan(firstOr(rows, "Crédit"));
}

/** CRE-01: the contractual schedule is built once and kept as version 1. */
export async function createLoan(
  tx: Tx,
  actor: Actor,
  input: CreateLoanWithScheduleInput,
): Promise<Loan> {
  const months = input.durationMonths;
  if (months === undefined) {
    ruleViolation("La durée en mois est nécessaire pour construire l’échéancier (CRE-01).");
  }

  const inserted = await tx
    .insert(tables.loan)
    .values({
      organizationId: actor.organizationId,
      legalEntityId: input.legalEntityId,
      lenderName: input.lenderName,
      reference: input.reference,
      principalAmount: input.principalAmount,
      releasedOn: input.releasedOn ?? null,
      durationMonths: months,
      rateKind: input.rateKind ?? "fixed",
      nominalRate: input.nominalRate ?? null,
      insuranceRate: input.insuranceRate ?? null,
      deferralMonths: input.deferralMonths ?? null,
      upfrontFees: input.upfrontFees ?? null,
      bankAccountId: input.bankAccountId ?? null,
      insuranceBasis: input.insuranceBasis ?? "initial_principal",
      status: "active",
    })
    .returning();
  const loan = firstOr(inserted, "Crédit");

  // Question 10: the bank's rule is the loan's, and it shapes the stored
  // schedule; an explicit monthly premium overrides both.
  const insurance =
    input.insuranceMonthly !== undefined || loan.insuranceRate === null
      ? undefined
      : {
          basis: input.insuranceBasis ?? ("initial_principal" as const),
          annualRate: asFraction(loan.insuranceRate),
        };

  const schedule = buildSchedule({
    principal: amount(loan.principalAmount),
    annualNominalRate: asFraction(loan.nominalRate),
    months,
    ...(input.insuranceMonthly === undefined ? {} : { insuranceMonthly: input.insuranceMonthly }),
    ...(insurance === undefined ? {} : { insurance }),
    feesMonthly: input.feesMonthly ?? "0.00",
    firstDueDate: input.firstDueOn,
    ...(input.deferralMonths
      ? { deferral: { months: input.deferralMonths, kind: input.deferralKind ?? "partial" } }
      : {}),
  });

  const version = firstOr(
    await tx
      .insert(tables.loanScheduleVersion)
      .values({
        organizationId: actor.organizationId,
        loanId: loan.id,
        sequence: 1,
        reason: "initial",
        effectiveFrom: input.firstDueOn,
        source: "computed",
        status: "active",
      })
      .returning(),
    "Échéancier",
  );

  await tx.insert(tables.loanInstallment).values(
    schedule.installments.map((installment) => ({
      organizationId: actor.organizationId,
      scheduleVersionId: version.id,
      installmentNumber: installment.number,
      dueOn: installment.dueDate,
      principalAmount: installment.capital,
      interestAmount: installment.interest,
      insuranceAmount: installment.insurance,
      feesAmount: installment.fees,
      totalAmount: installment.total,
      remainingPrincipal: installment.remainingPrincipal,
      currency: loan.currency,
      status: "forecast" as const,
    })),
  );

  await recordFact(tx, actor, {
    kind: "loan",
    id: loan.id,
    type: "loan.created",
    payload: {
      principalAmount: amount(loan.principalAmount),
      installments: schedule.installments.length,
      totalInterest: schedule.totalInterest,
    },
  });
  await audit(tx, actor, {
    objectTable: "loan",
    objectId: loan.id,
    action: "create",
    after: { reference: loan.reference, totalPaid: schedule.totalPaid },
  });

  return mapLoan(loan);
}

/** WF-08: each installment is matched against a debit of the same date and amount. */
export async function getSchedule(tx: Tx, loanId: string): Promise<LoanSchedule> {
  const loan = firstOr(
    await tx.select().from(tables.loan).where(eq(tables.loan.id, loanId)).limit(1),
    "Crédit",
  );
  const versions = await tx
    .select()
    .from(tables.loanScheduleVersion)
    .where(eq(tables.loanScheduleVersion.loanId, loanId))
    .orderBy(desc(tables.loanScheduleVersion.sequence));
  const version = versions.find((row) => row.status === "active");

  const counts =
    versions.length === 0
      ? []
      : await tx
          .select({
            scheduleVersionId: tables.loanInstallment.scheduleVersionId,
            total: sql<number>`count(*)::int`,
          })
          .from(tables.loanInstallment)
          .where(
            inArray(
              tables.loanInstallment.scheduleVersionId,
              versions.map((row) => row.id),
            ),
          )
          .groupBy(tables.loanInstallment.scheduleVersionId);
  const countByVersion = new Map(counts.map((row) => [row.scheduleVersionId, row.total]));

  const rows = version
    ? await tx
        .select()
        .from(tables.loanInstallment)
        .where(eq(tables.loanInstallment.scheduleVersionId, version.id))
        .orderBy(asc(tables.loanInstallment.installmentNumber))
    : [];

  const debits =
    loan.bankAccountId === null || rows.length === 0
      ? []
      : await tx
          .select({
            bookedOn: tables.bankTransaction.bookedOn,
            amount: tables.bankTransaction.amount,
          })
          .from(tables.bankTransaction)
          .where(
            and(
              eq(tables.bankTransaction.bankAccountId, loan.bankAccountId),
              inArray(
                tables.bankTransaction.bookedOn,
                rows.map((row) => row.dueOn),
              ),
            ),
          );
  const debitByDate = new Map(
    debits.map((debit) => [debit.bookedOn, toMoney(decimal(debit.amount).abs())]),
  );

  const installments = rows.map((row) =>
    withDebitMatch(mapInstallment(row), debitByDate.get(row.dueOn) ?? null),
  );

  const totalPrincipal = sumAmounts(installments.map((row) => row.principalAmount));
  const lines = installments.map((row) => ({
    dueDate: row.dueOn,
    capital: row.principalAmount,
    interest: row.interestAmount,
    insurance: row.insuranceAmount,
    fees: row.feesAmount,
    total: row.totalAmount,
    remainingPrincipal: row.remainingPrincipal,
  }));
  const asOf = today();
  const progress = scheduleProgress({
    principal: amount(loan.principalAmount),
    installments: lines,
    on: asOf,
  });

  // CRE-01: the accounting balance wins over the forecast one when Odoo answered.
  const fromOdoo = loan.odooOutstandingPrincipal !== null;

  return {
    loanId,
    currency: loan.currency,
    installments,
    totalPrincipal,
    totalInterest: sumAmounts(installments.map((row) => row.interestAmount)),
    totalInsurance: sumAmounts(installments.map((row) => row.insuranceAmount)),
    totalFees: sumAmounts(installments.map((row) => row.feesAmount)),
    totalPaid: sumAmounts(installments.map((row) => row.totalAmount)),
    principalMatchesLoan: totalPrincipal === amount(loan.principalAmount),
    versions: versions.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      reason: row.reason,
      source: row.source,
      effectiveFrom: row.effectiveFrom,
      status: row.status,
      installments: countByVersion.get(row.id) ?? 0,
    })),
    activeVersionId: version?.id ?? null,
    deferredInstallments: installments.filter((row) => row.principalAmount === "0.00").length,
    insuranceBasis: insuranceBasisOf(lines),
    storedInsuranceBasis: loan.insuranceBasis as "initial_principal" | "outstanding_principal",
    insuranceBasisMismatch: insuranceBasisMismatch(loan.insuranceBasis, insuranceBasisOf(lines)),
    progress: {
      ...progress,
      outstandingPrincipal: fromOdoo
        ? amount(loan.odooOutstandingPrincipal)
        : progress.outstandingPrincipal,
      outstandingSource: fromOdoo ? ("odoo" as const) : ("saas_projection" as const),
    },
    properties: await propertiesOf(tx, loanId),
  };
}

async function propertiesOf(tx: Tx, loanId: string): Promise<LoanPropertyLink[]> {
  const rows = await tx
    .select({
      id: tables.loanProperty.id,
      buildingId: tables.loanProperty.buildingId,
      unitId: tables.loanProperty.unitId,
      financedShare: tables.loanProperty.financedShare,
      buildingName: tables.building.name,
      unitLabel: tables.unit.label,
      unitCode: tables.unit.code,
    })
    .from(tables.loanProperty)
    .leftJoin(tables.building, eq(tables.loanProperty.buildingId, tables.building.id))
    .leftJoin(tables.unit, eq(tables.loanProperty.unitId, tables.unit.id))
    .where(eq(tables.loanProperty.loanId, loanId));
  return rows.map((row) => ({
    id: row.id,
    buildingId: row.buildingId,
    unitId: row.unitId,
    label:
      row.unitId === null
        ? (row.buildingName ?? "Immeuble")
        : `${row.unitCode ?? ""} — ${row.unitLabel ?? ""}`.trim(),
    financedShare: row.financedShare,
  }));
}

export async function updateLoan(tx: Tx, actor: Actor, input: UpdateLoanInput): Promise<Loan> {
  const patch = {
    ...(input.lenderName === undefined ? {} : { lenderName: input.lenderName }),
    ...(input.nominalRate === undefined ? {} : { nominalRate: input.nominalRate }),
    ...(input.insuranceRate === undefined ? {} : { insuranceRate: input.insuranceRate }),
    ...(input.bankAccountId === undefined ? {} : { bankAccountId: input.bankAccountId }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
  const updated = await tx
    .update(tables.loan)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(and(eq(tables.loan.id, input.id), eq(tables.loan.version, input.expectedVersion)))
    .returning();
  const loan = updated[0];
  if (!loan) versionConflict("Le crédit");
  await audit(tx, actor, {
    objectTable: "loan",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return mapLoan(loan);
}

/** CRE-01: a loan names the properties it financed; the share is optional. */
export async function linkProperty(
  tx: Tx,
  actor: Actor,
  input: LinkLoanPropertyInput,
): Promise<{ properties: LoanPropertyLink[] }> {
  if ((input.buildingId === undefined) === (input.unitId === undefined)) {
    ruleViolation("Rattachez le crédit à un immeuble ou à un lot, pas aux deux.");
  }
  const inserted = await tx
    .insert(tables.loanProperty)
    .values({
      organizationId: actor.organizationId,
      loanId: input.loanId,
      buildingId: input.buildingId ?? null,
      unitId: input.unitId ?? null,
      financedShare: input.financedShare ?? null,
    })
    .returning();
  const link = firstOr(inserted, "Bien financé");
  await audit(tx, actor, {
    objectTable: "loan_property",
    objectId: link.id,
    action: "create",
    after: { loanId: input.loanId, buildingId: link.buildingId, unitId: link.unitId },
  });
  return { properties: await propertiesOf(tx, input.loanId) };
}

export async function unlinkProperty(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<{ properties: LoanPropertyLink[] }> {
  const deleted = await tx
    .delete(tables.loanProperty)
    .where(eq(tables.loanProperty.id, id))
    .returning();
  const link = firstOr(deleted, "Bien financé");
  await audit(tx, actor, {
    objectTable: "loan_property",
    objectId: id,
    action: "delete",
    before: { loanId: link.loanId },
  });
  return { properties: await propertiesOf(tx, link.loanId) };
}

/** Observed premiums that fit neither rule are not a disagreement, only an unknown. */
export function insuranceBasisMismatch(stored: string, observed: string): boolean {
  return (
    (observed === "initial_principal" || observed === "outstanding_principal") &&
    observed !== stored
  );
}
