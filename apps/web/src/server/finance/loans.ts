import "server-only";
import type { Loan } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { buildSchedule, decimal, toMoney } from "@lfsci/domain";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { CreateLoanWithScheduleInput, LoanSchedule } from "@/lib/contracts/finance";
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
      status: "active",
    })
    .returning();
  const loan = firstOr(inserted, "Crédit");

  const insuranceMonthly =
    input.insuranceMonthly ??
    (loan.insuranceRate === null
      ? "0.00"
      : toMoney(
          decimal(loan.principalAmount)
            .times(decimal(asFraction(loan.insuranceRate)))
            .dividedBy(12),
        ));

  const schedule = buildSchedule({
    principal: amount(loan.principalAmount),
    annualNominalRate: asFraction(loan.nominalRate),
    months,
    insuranceMonthly,
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
    .where(
      and(
        eq(tables.loanScheduleVersion.loanId, loanId),
        eq(tables.loanScheduleVersion.status, "active"),
      ),
    )
    .orderBy(desc(tables.loanScheduleVersion.sequence))
    .limit(1);
  const version = versions[0];

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
  };
}
