import { type Decimal, maxOf, money, sum, toMoney, ZERO } from "./money";
import { type IsoDateString, parseIsoDate } from "./periods";
import { type Blocked, blocked } from "./result";

export type TermBalance = {
  termId: string;
  rent: string;
  charges: string;
  paidRent: string;
  paidCharges: string;
};

export type Allocation = { termId: string; rent: string; charges: string };

export type Payment = { paymentId: string; amount: string };

export type TermStatus = "unpaid" | "partial" | "paid";
export type PaymentStatus = "fully_allocated" | "partial" | "overpaid";

export type AllocatedTerm = {
  termId: string;
  status: TermStatus;
  rent: string;
  charges: string;
  paidRent: string;
  paidCharges: string;
  outstandingRent: string;
  outstandingCharges: string;
  outstanding: string;
  receipt: ReceiptKind;
};

export type AllocationBlockedReason =
  | "unknown_term"
  | "negative_allocation"
  | "allocation_exceeds_payment"
  | "allocation_exceeds_outstanding";

export type AllocationResult =
  | {
      ok: true;
      paymentId: string;
      amount: string;
      allocated: string;
      unallocated: string;
      overpayment: string;
      status: PaymentStatus;
      terms: AllocatedTerm[];
    }
  | Blocked<AllocationBlockedReason>;

export type ReceiptKind = "quittance" | "recu";

export function receiptKind(term: {
  rent: string;
  charges: string;
  paidRent: string;
  paidCharges: string;
}): ReceiptKind {
  const rentPaid = money(term.paidRent).greaterThanOrEqualTo(money(term.rent));
  const chargesPaid = money(term.paidCharges).greaterThanOrEqualTo(money(term.charges));
  return rentPaid && chargesPaid ? "quittance" : "recu";
}

function statusOf(paid: Decimal, due: Decimal): TermStatus {
  if (paid.greaterThanOrEqualTo(due)) return "paid";
  return paid.isZero() ? "unpaid" : "partial";
}

export function allocatePayment(input: {
  payment: Payment;
  terms: readonly TermBalance[];
  allocations: readonly Allocation[];
}): AllocationResult {
  const byId = new Map(input.terms.map((t) => [t.termId, t]));
  const unknown = input.allocations.filter((a) => !byId.has(a.termId)).map((a) => a.termId);
  if (unknown.length > 0) return blocked("unknown_term", unknown);

  const negative = input.allocations
    .filter((a) => money(a.rent).isNegative() || money(a.charges).isNegative())
    .map((a) => a.termId);
  if (negative.length > 0) return blocked("negative_allocation", negative);

  const amount = money(input.payment.amount);
  const allocated = sum(input.allocations.map((a) => money(a.rent).plus(money(a.charges))));
  if (allocated.greaterThan(amount)) {
    return blocked("allocation_exceeds_payment", [input.payment.paymentId]);
  }

  const overAllocated: string[] = [];
  const applied = new Map<string, { rent: Decimal; charges: Decimal }>();
  for (const allocation of input.allocations) {
    const term = byId.get(allocation.termId);
    if (term === undefined) continue;
    const previous = applied.get(allocation.termId) ?? { rent: ZERO, charges: ZERO };
    const rent = previous.rent.plus(money(allocation.rent));
    const charges = previous.charges.plus(money(allocation.charges));
    const outstandingRent = money(term.rent).minus(money(term.paidRent));
    const outstandingCharges = money(term.charges).minus(money(term.paidCharges));
    if (rent.greaterThan(outstandingRent) || charges.greaterThan(outstandingCharges)) {
      overAllocated.push(allocation.termId);
    }
    applied.set(allocation.termId, { rent, charges });
  }
  if (overAllocated.length > 0) return blocked("allocation_exceeds_outstanding", overAllocated);

  const terms: AllocatedTerm[] = input.terms.map((term) => {
    const add = applied.get(term.termId) ?? { rent: ZERO, charges: ZERO };
    const paidRent = money(term.paidRent).plus(add.rent);
    const paidCharges = money(term.paidCharges).plus(add.charges);
    const due = money(term.rent).plus(money(term.charges));
    const paid = paidRent.plus(paidCharges);
    const outstandingRent = money(term.rent).minus(paidRent);
    const outstandingCharges = money(term.charges).minus(paidCharges);
    const view = {
      rent: toMoney(money(term.rent)),
      charges: toMoney(money(term.charges)),
      paidRent: toMoney(paidRent),
      paidCharges: toMoney(paidCharges),
    };
    return {
      termId: term.termId,
      status: statusOf(paid, due),
      ...view,
      outstandingRent: toMoney(outstandingRent),
      outstandingCharges: toMoney(outstandingCharges),
      outstanding: toMoney(outstandingRent.plus(outstandingCharges)),
      receipt: receiptKind(view),
    };
  });

  const unallocated = amount.minus(allocated);
  const remainingOutstanding = sum(terms.map((t) => money(t.outstanding)));
  const status: PaymentStatus = unallocated.isZero()
    ? "fully_allocated"
    : remainingOutstanding.isZero()
      ? "overpaid"
      : "partial";

  return {
    ok: true,
    paymentId: input.payment.paymentId,
    amount: toMoney(amount),
    allocated: toMoney(allocated),
    unallocated: toMoney(unallocated),
    overpayment: toMoney(status === "overpaid" ? unallocated : ZERO),
    status,
    terms,
  };
}

/**
 * LOY-04 qualification of an unpaid term. Only `due` is a plain arrear: every
 * other value means the automation must stop and a human must look.
 */
export type ArrearsQualification =
  | "due"
  | "unapplied_receipt"
  | "payment_in_transit"
  | "disputed"
  | "sync_incident";

export type ReminderLevel = "reminder_1" | "reminder_2" | "formal_notice";

export type ReminderPolicy = {
  graceDays: number;
  firstReminderDays: number;
  secondReminderDays: number;
  formalNoticeDays: number;
  minimumSpacingDays: number;
  minimumOutstanding: string;
  staleBankFeedDays: number;
};

/** Delays are the owner's to approve (LOY-04, "délais approuvés"); these are the defaults. */
export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  graceDays: 5,
  firstReminderDays: 8,
  secondReminderDays: 21,
  formalNoticeDays: 45,
  minimumSpacingDays: 8,
  minimumOutstanding: "5.00",
  staleBankFeedDays: 7,
};

const LEVEL_RANK: Record<ReminderLevel, number> = {
  reminder_1: 1,
  reminder_2: 2,
  formal_notice: 3,
};

export const reminderLevels: readonly ReminderLevel[] = [
  "reminder_1",
  "reminder_2",
  "formal_notice",
];

/** §17.1: a plain reminder is routine (C); a mise en demeure is a sensitive act (D). */
export function autonomyForReminder(level: ReminderLevel): "C" | "D" {
  return level === "formal_notice" ? "D" : "C";
}

/**
 * Signed day distance between two civil dates. `daysBetween` counts days
 * inclusively and clamps to zero, which cannot express "not due yet".
 */
export function daysLate(from: IsoDateString, to: IsoDateString): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

export function isArrearsAutomationSuspended(qualification: ArrearsQualification): boolean {
  return qualification !== "due";
}

export function outstandingOf(term: { total: string; allocated: string }): string {
  return toMoney(maxOf(money(term.total).minus(money(term.allocated)), ZERO));
}

export type ArrearsQualificationInput = {
  termStatus: string;
  leaseStatus: string;
  /** Allocated to the term but not yet confirmed by the ledger. */
  pendingAllocated: string;
  /** Received from this tenant and not allocated to anything (LOY-02). */
  unappliedCredit: string;
  /** Days since the last successful ledger read; null when no connector is tracked yet. */
  ledgerStaleDays: number | null;
  ledgerHealthy: boolean;
  policy?: ReminderPolicy;
};

export function qualifyArrears(input: ArrearsQualificationInput): ArrearsQualification {
  const policy = input.policy ?? DEFAULT_REMINDER_POLICY;
  if (input.termStatus === "disputed" || input.leaseStatus === "disputed") return "disputed";
  if (!input.ledgerHealthy) return "sync_incident";
  if (input.ledgerStaleDays !== null && input.ledgerStaleDays > policy.staleBankFeedDays) {
    return "sync_incident";
  }
  if (money(input.pendingAllocated).greaterThan(ZERO)) return "payment_in_transit";
  if (money(input.unappliedCredit).greaterThan(ZERO)) return "unapplied_receipt";
  return "due";
}

export type ReminderHoldReason =
  | "settled"
  | "suspended"
  | "negligible_amount"
  | "within_grace"
  | "max_level_reached"
  | "too_soon";

export type ReminderDecision =
  | { propose: false; reason: ReminderHoldReason; level: null; daysLate: number }
  | { propose: true; reason: null; level: ReminderLevel; autonomy: "C" | "D"; daysLate: number };

export type ReminderGradeInput = {
  today: IsoDateString;
  dueOn: IsoDateString;
  outstanding: string;
  qualification: ArrearsQualification;
  lastLevel: ReminderLevel | null;
  lastSentOn: IsoDateString | null;
  policy?: ReminderPolicy;
};

function thresholdOf(policy: ReminderPolicy, level: ReminderLevel): number {
  if (level === "reminder_1") return policy.firstReminderDays;
  if (level === "reminder_2") return policy.secondReminderDays;
  return policy.formalNoticeDays;
}

function nextLevelAfter(level: ReminderLevel | null): ReminderLevel | null {
  if (level === null) return "reminder_1";
  if (level === "reminder_1") return "reminder_2";
  if (level === "reminder_2") return "formal_notice";
  return null;
}

/**
 * LOY-04: the delay decides how far the ladder may go, the history decides the
 * next rung. A long-standing arrear never jumps straight to a mise en demeure —
 * the escalation is one step at a time, so the owner always has a refused step
 * to point at.
 */
export function gradeReminder(input: ReminderGradeInput): ReminderDecision {
  const policy = input.policy ?? DEFAULT_REMINDER_POLICY;
  const late = daysLate(input.dueOn, input.today);
  const hold = (reason: ReminderHoldReason): ReminderDecision => ({
    propose: false,
    reason,
    level: null,
    daysLate: late,
  });

  if (money(input.outstanding).lessThanOrEqualTo(ZERO)) return hold("settled");
  if (isArrearsAutomationSuspended(input.qualification)) return hold("suspended");
  if (money(input.outstanding).lessThan(money(policy.minimumOutstanding))) {
    return hold("negligible_amount");
  }
  if (late <= policy.graceDays) return hold("within_grace");

  const next = nextLevelAfter(input.lastLevel);
  if (next === null) return hold("max_level_reached");
  if (late < thresholdOf(policy, next)) return hold("within_grace");

  const reached = reminderLevels.filter((level) => late >= thresholdOf(policy, level)).at(-1);
  if (reached === undefined || LEVEL_RANK[next] > LEVEL_RANK[reached]) return hold("too_soon");

  if (
    input.lastSentOn !== null &&
    daysLate(input.lastSentOn, input.today) < policy.minimumSpacingDays
  ) {
    return hold("too_soon");
  }

  return {
    propose: true,
    reason: null,
    level: next,
    autonomy: autonomyForReminder(next),
    daysLate: late,
  };
}
