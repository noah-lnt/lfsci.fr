import { money, sum, toMoney } from "./money";
import { type Blocked, blocked } from "./result";

export type Booking = {
  bookingId: string;
  accommodation: string;
  cleaning?: string | undefined;
  otherServices?: string | undefined;
  refunds?: string | undefined;
  commission?: string | undefined;
  taxCollected?: string | undefined;
  taxRemitted?: string | undefined;
};

export type BookingLine = {
  bookingId: string;
  grossServices: string;
  refunds: string;
  netOfRefunds: string;
  commission: string;
  taxCollected: string;
  taxRemitted: string;
  taxFlow: string;
  net: string;
};

export type PayoutExpectation = {
  bookings: BookingLine[];
  grossServices: string;
  refunds: string;
  netOfRefunds: string;
  commissions: string;
  taxCollected: string;
  taxRemitted: string;
  taxFlow: string;
  netPayout: string;
  revenueRecognised: string;
};

// AIR-02 / F04 : les taxes de séjour transitent pour compte de tiers et ne sont
// pas un revenu ; le virement net n'est pas un chiffre d'affaires additionnel.
export function bookingLine(booking: Booking): BookingLine {
  const gross = money(booking.accommodation)
    .plus(money(booking.cleaning ?? "0.00"))
    .plus(money(booking.otherServices ?? "0.00"));
  const refunds = money(booking.refunds ?? "0.00");
  const commission = money(booking.commission ?? "0.00");
  const taxCollected = money(booking.taxCollected ?? "0.00");
  const taxRemitted = money(booking.taxRemitted ?? "0.00");
  const netOfRefunds = gross.minus(refunds);
  const taxFlow = taxCollected.minus(taxRemitted);
  return {
    bookingId: booking.bookingId,
    grossServices: toMoney(gross),
    refunds: toMoney(refunds),
    netOfRefunds: toMoney(netOfRefunds),
    commission: toMoney(commission),
    taxCollected: toMoney(taxCollected),
    taxRemitted: toMoney(taxRemitted),
    taxFlow: toMoney(taxFlow),
    net: toMoney(netOfRefunds.minus(commission).plus(taxFlow)),
  };
}

export function expectedPayout(bookings: readonly Booking[]): PayoutExpectation {
  const lines = bookings.map(bookingLine);
  const total = (key: keyof BookingLine): string =>
    toMoney(sum(lines.map((l) => money(String(l[key])))));
  return {
    bookings: lines,
    grossServices: total("grossServices"),
    refunds: total("refunds"),
    netOfRefunds: total("netOfRefunds"),
    commissions: total("commission"),
    taxCollected: total("taxCollected"),
    taxRemitted: total("taxRemitted"),
    taxFlow: total("taxFlow"),
    netPayout: total("net"),
    revenueRecognised: total("netOfRefunds"),
  };
}

export type PayoutMatch =
  | { ok: true; kind: "exact"; netPayout: string; bookingIds: string[] }
  | (Blocked<"payout_mismatch"> & { difference: string; netPayout: string });

export function matchPayout(input: {
  bookings: readonly Booking[];
  bankAmount: string;
}): PayoutMatch {
  const expectation = expectedPayout(input.bookings);
  const expected = money(expectation.netPayout);
  const actual = money(input.bankAmount);
  if (expected.equals(actual)) {
    return {
      ok: true,
      kind: "exact",
      netPayout: expectation.netPayout,
      bookingIds: input.bookings.map((b) => b.bookingId),
    };
  }
  return {
    ...blocked(
      "payout_mismatch",
      input.bookings.map((b) => b.bookingId),
    ),
    difference: toMoney(actual.minus(expected)),
    netPayout: expectation.netPayout,
  };
}

export type PayoutAdjustmentKind = "correction" | "retention" | "other_period";

export type PayoutAdjustment = {
  reference: string;
  kind: PayoutAdjustmentKind;
  amount: string;
  label?: string | undefined;
};

export type GroupedPayout = {
  expectation: PayoutExpectation;
  adjustments: PayoutAdjustment[];
  adjustmentTotal: string;
  bookingNet: string;
  expectedNet: string;
  declaredNet: string;
  difference: string;
  matched: boolean;
  match: PayoutMatch;
};

/**
 * AIR-02: one transfer settles several stays and may carry corrections or
 * retentions from another period. They stay distinct from the booking lines and
 * the difference is published, never absorbed to force a balance.
 */
export function reconcileGroupedPayout(input: {
  bookings: readonly Booking[];
  adjustments?: readonly PayoutAdjustment[];
  declaredNet: string;
}): GroupedPayout {
  const expectation = expectedPayout(input.bookings);
  const adjustments = [...(input.adjustments ?? [])];
  const adjustmentTotal = toMoney(sum(adjustments.map((a) => money(a.amount))));
  const bookingNet = expectation.netPayout;
  const expectedNet = toMoney(money(bookingNet).plus(money(adjustmentTotal)));
  const difference = toMoney(money(input.declaredNet).minus(money(expectedNet)));
  return {
    expectation,
    adjustments,
    adjustmentTotal,
    bookingNet,
    expectedNet,
    declaredNet: toMoney(money(input.declaredNet)),
    difference,
    matched: money(difference).isZero(),
    match: matchPayout({
      bookings: input.bookings,
      bankAmount: toMoney(money(input.declaredNet).minus(money(adjustmentTotal))),
    }),
  };
}
