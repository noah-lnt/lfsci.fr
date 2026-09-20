import { describe, expect, it } from "vitest";
import type { Booking, PayoutAdjustment } from "../src/bookings";
import { reconcileGroupedPayout } from "../src/bookings";

const stays: Booking[] = [
  {
    bookingId: "HMABC1",
    accommodation: "820.00",
    cleaning: "70.00",
    commission: "26.70",
    taxCollected: "24.00",
    taxRemitted: "24.00",
  },
  {
    bookingId: "HMABC2",
    accommodation: "540.00",
    cleaning: "70.00",
    refunds: "150.00",
    commission: "13.80",
    taxCollected: "16.00",
    taxRemitted: "16.00",
  },
];

const retention: PayoutAdjustment = {
  reference: "ADJ-2026-03",
  kind: "retention",
  amount: "-45.00",
  label: "Retenue période précédente",
};

describe("AIR-02 — grouped payout with a refund and a retention", () => {
  it("reconstructs the expected net from the stays and the adjustment", () => {
    const result = reconcileGroupedPayout({
      bookings: stays,
      adjustments: [retention],
      declaredNet: "1264.50",
    });
    expect(result.bookingNet).toBe("1309.50");
    expect(result.adjustmentTotal).toBe("-45.00");
    expect(result.expectedNet).toBe("1264.50");
    expect(result.matched).toBe(true);
    expect(result.difference).toBe("0.00");
  });

  it("keeps the refund out of the recognised revenue and the tax flow at zero", () => {
    const result = reconcileGroupedPayout({
      bookings: stays,
      adjustments: [retention],
      declaredNet: "1264.50",
    });
    expect(result.expectation.grossServices).toBe("1500.00");
    expect(result.expectation.refunds).toBe("150.00");
    expect(result.expectation.revenueRecognised).toBe("1350.00");
    expect(result.expectation.taxFlow).toBe("0.00");
  });

  it("publishes the difference instead of balancing the transfer", () => {
    const result = reconcileGroupedPayout({
      bookings: stays,
      adjustments: [retention],
      declaredNet: "1279.00",
    });
    expect(result.matched).toBe(false);
    expect(result.difference).toBe("14.50");
    expect(result.expectedNet).toBe("1264.50");
    expect(result.match.ok).toBe(false);
    expect(result.match.ok === false && result.match.reason).toBe("payout_mismatch");
  });

  it("keeps the adjustments listed apart from the booking lines", () => {
    const result = reconcileGroupedPayout({
      bookings: stays,
      adjustments: [retention],
      declaredNet: "1264.50",
    });
    expect(result.expectation.bookings.map((line) => line.bookingId)).toEqual(["HMABC1", "HMABC2"]);
    expect(result.adjustments).toEqual([retention]);
  });

  it("falls back to the booking net when nothing was withheld", () => {
    const result = reconcileGroupedPayout({ bookings: stays, declaredNet: "1309.50" });
    expect(result.adjustmentTotal).toBe("0.00");
    expect(result.expectedNet).toBe("1309.50");
    expect(result.matched).toBe(true);
  });
});
