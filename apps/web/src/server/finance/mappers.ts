import "server-only";
import type {
  CcaMovement,
  Expense,
  ExpenseAllocation,
  ExpenseLine,
  FixedAsset,
  Loan,
  LoanInstallment,
  PartnerCurrentAccount,
  Supplier,
} from "@lfsci/contracts";
import type { tables } from "@lfsci/db";
import { accumulatedAt, decimal, matchDebit, toMoney } from "@lfsci/domain";
import type {
  BankAccountSummary,
  FixedAssetPosition,
  InstallmentWithMatch,
} from "@/lib/contracts/finance";
import { amount, amountOrNull, instant, instantOrNow } from "./shared";

type ExpenseRow = typeof tables.expense.$inferSelect;
type ExpenseLineRow = typeof tables.expenseLine.$inferSelect;
type ExpenseAllocationRow = typeof tables.expenseAllocation.$inferSelect;
type SupplierRow = typeof tables.supplier.$inferSelect;
type LoanRow = typeof tables.loan.$inferSelect;
type InstallmentRow = typeof tables.loanInstallment.$inferSelect;
type CcaRow = typeof tables.partnerCurrentAccount.$inferSelect;
type CcaMovementRow = typeof tables.ccaMovement.$inferSelect;
type FixedAssetRow = typeof tables.fixedAsset.$inferSelect;
type BankAccountRow = typeof tables.bankAccount.$inferSelect;

function audited(row: { createdAt: string; updatedAt: string | null; version: number }) {
  return {
    createdAt: instantOrNow(row.createdAt),
    updatedAt: instant(row.updatedAt),
    version: row.version,
  };
}

export function mapAllocation(row: ExpenseAllocationRow): ExpenseAllocation {
  return {
    id: row.id,
    ...audited(row),
    expenseLineId: row.expenseLineId,
    target: row.target as ExpenseAllocation["target"],
    unitId: row.unitId,
    buildingId: row.buildingId,
    legalEntityId: row.legalEntityId,
    amount: amount(row.amount),
    currency: row.currency,
    recoverableAmount: amount(row.recoverableAmount),
    keyVersionId: row.keyVersionId,
    ruleVersionId: row.ruleVersionId,
    aiExtractionId: row.aiExtractionId,
  };
}

export function mapExpenseLine(
  row: ExpenseLineRow,
  allocations: readonly ExpenseAllocationRow[],
): ExpenseLine {
  return {
    id: row.id,
    ...audited(row),
    expenseId: row.expenseId,
    lineNumber: row.lineNumber,
    description: row.description,
    quantity: row.quantity,
    amountExclTax: amountOrNull(row.amountExclTax),
    taxAmount: amountOrNull(row.taxAmount),
    amountInclTax: amount(row.amountInclTax),
    currency: row.currency,
    chargeNature: row.chargeNature,
    recoverableShare: row.recoverableShare,
    servicePeriodStart: row.servicePeriodStart,
    servicePeriodEnd: row.servicePeriodEnd,
    unallocatedAmount: amount(row.unallocatedAmount),
    allocations: allocations
      .filter((allocation) => allocation.expenseLineId === row.id)
      .map(mapAllocation),
  };
}

export function mapExpense(
  row: ExpenseRow,
  lines: readonly ExpenseLineRow[],
  allocations: readonly ExpenseAllocationRow[],
): Expense {
  return {
    id: row.id,
    ...audited(row),
    legalEntityId: row.legalEntityId,
    supplierId: row.supplierId,
    worksProjectId: row.worksProjectId,
    interventionId: row.interventionId,
    documentKind: row.documentKind as Expense["documentKind"],
    supplierReference: row.supplierReference,
    issuedOn: row.issuedOn,
    totalExclTax: amountOrNull(row.totalExclTax),
    taxAmount: amountOrNull(row.taxAmount),
    totalInclTax: amount(row.totalInclTax),
    currency: row.currency,
    payer: row.payer as Expense["payer"],
    paidByPersonId: row.paidByPersonId,
    duplicateOfExpenseId: row.duplicateOfExpenseId,
    creditNoteOfExpenseId: row.creditNoteOfExpenseId,
    status: row.status as Expense["status"],
    odooMoveName: row.odooMoveName,
    odooReadAt: instant(row.odooReadAt),
    lines: [...lines]
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => mapExpenseLine(line, allocations)),
  };
}

export function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    ...audited(row),
    name: row.name,
    trade: row.trade,
    siren: row.siren,
    personId: row.personId,
    paymentIbanLast4: row.paymentIbanLast4,
    paymentIdentityValidatedAt: instant(row.paymentIdentityValidatedAt),
    status: row.status as Supplier["status"],
  };
}

export function mapLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    ...audited(row),
    legalEntityId: row.legalEntityId,
    lenderName: row.lenderName,
    reference: row.reference,
    principalAmount: amount(row.principalAmount),
    currency: row.currency,
    releasedOn: row.releasedOn,
    durationMonths: row.durationMonths,
    rateKind: row.rateKind as Loan["rateKind"],
    nominalRate: row.nominalRate,
    insuranceRate: row.insuranceRate,
    deferralMonths: row.deferralMonths,
    upfrontFees: amountOrNull(row.upfrontFees),
    bankAccountId: row.bankAccountId,
    odooOutstandingPrincipal: amountOrNull(row.odooOutstandingPrincipal),
    odooReadAt: instant(row.odooReadAt),
    status: row.status as Loan["status"],
  };
}

export function mapInstallment(row: InstallmentRow): LoanInstallment {
  return {
    id: row.id,
    ...audited(row),
    scheduleVersionId: row.scheduleVersionId,
    installmentNumber: row.installmentNumber,
    dueOn: row.dueOn,
    principalAmount: amount(row.principalAmount),
    interestAmount: amount(row.interestAmount),
    insuranceAmount: amount(row.insuranceAmount),
    feesAmount: amount(row.feesAmount),
    totalAmount: amount(row.totalAmount),
    remainingPrincipal: amountOrNull(row.remainingPrincipal),
    currency: row.currency,
    bankTransactionId: row.bankTransactionId,
    matchedAt: instant(row.matchedAt),
    varianceReason: row.varianceReason,
    status: row.status as LoanInstallment["status"],
  };
}

/** WF-08: the debit is compared to the expected components, never assumed equal. */
export function withDebitMatch(
  installment: LoanInstallment,
  debitAmount: string | null,
): InstallmentWithMatch {
  if (debitAmount === null) {
    return { ...installment, matchStatus: "no_debit", matchDifference: null };
  }
  const match = matchDebit(installment.totalAmount, amount(debitAmount));
  return match.ok
    ? { ...installment, matchStatus: "exact", matchDifference: "0.00" }
    : { ...installment, matchStatus: "amount_mismatch", matchDifference: match.difference };
}

export function mapCurrentAccount(row: CcaRow, projectedBalance: string): PartnerCurrentAccount {
  return {
    id: row.id,
    ...audited(row),
    legalEntityId: row.legalEntityId,
    partnerPersonId: row.partnerPersonId,
    agreementDocumentId: row.agreementDocumentId,
    interestRate: row.interestRate,
    conditions: row.conditions,
    currency: row.currency,
    odooBalance: amountOrNull(row.odooBalance),
    odooReadAt: instant(row.odooReadAt),
    projectedBalance,
    status: row.status as PartnerCurrentAccount["status"],
  };
}

export function mapCcaMovement(row: CcaMovementRow): CcaMovement {
  return {
    id: row.id,
    ...audited(row),
    ccaId: row.ccaId,
    kind: row.kind as CcaMovement["kind"],
    amount: amount(row.amount),
    currency: row.currency,
    occurredOn: row.occurredOn,
    expenseId: row.expenseId,
    paymentId: row.paymentId,
    bankTransactionId: row.bankTransactionId,
    approvalId: row.approvalId,
    status: row.status as CcaMovement["status"],
    odooReadAt: instant(row.odooReadAt),
  };
}

export function mapFixedAsset(row: FixedAssetRow): FixedAsset {
  return {
    id: row.id,
    ...audited(row),
    legalEntityId: row.legalEntityId,
    buildingId: row.buildingId,
    unitId: row.unitId,
    label: row.label,
    grossValue: amount(row.grossValue),
    landValue: amount(row.landValue),
    currency: row.currency,
    commissionedOn: row.commissionedOn,
    durationYears: row.durationYears,
    method: row.method as FixedAsset["method"],
    accumulatedDepreciation: amount(row.accumulatedDepreciation),
    netBookValue: amountOrNull(row.netBookValue),
    disposedOn: row.disposedOn,
    odooReadAt: instant(row.odooReadAt),
    status: row.status as FixedAsset["status"],
  };
}

/**
 * IMM-02: only the construction share depreciates. With no commissioning date,
 * no duration or an explicit "none" method, the position falls back to the
 * depreciation already posted.
 */
export function mapFixedAssetPosition(row: FixedAssetRow, on: string): FixedAssetPosition {
  const asset = mapFixedAsset(row);
  const depreciableGross = toMoney(decimal(asset.grossValue).minus(decimal(asset.landValue)));
  const months = row.durationYears === null ? 0 : Math.round(Number(row.durationYears) * 12);
  const start = row.commissionedOn;
  const computable = start !== null && months > 0 && row.method !== "none";
  const accumulated = computable
    ? accumulatedAt(
        { id: asset.id, kind: "building", gross: depreciableGross, startDate: start, months },
        on,
      )
    : asset.accumulatedDepreciation;
  return {
    ...asset,
    depreciableGross,
    accumulatedAt: accumulated,
    netBookValueAt: toMoney(decimal(asset.grossValue).minus(decimal(accumulated))),
    computedOn: on,
  };
}

export function mapBankAccount(row: BankAccountRow): BankAccountSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    label: row.label,
    bankName: row.bankName,
    ibanLast4: row.ibanLast4,
    purpose: row.purpose,
    currency: row.currency,
    openingBalance: amount(row.openingBalance),
    openingBalanceOn: row.openingBalanceOn,
    feedSource: row.feedSource,
    feedLastSuccessAt: instant(row.feedLastSuccessAt),
    status: row.status,
  };
}
