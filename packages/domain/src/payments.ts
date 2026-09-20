import { type Decimal, money, sum, toMoney, ZERO } from "./money";
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
