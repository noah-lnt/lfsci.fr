import { describe, expect, it } from "vitest";
import { type Booking, bookingLine, expectedPayout, matchPayout } from "../src/bookings";

const bookings: Booking[] = [
  {
    bookingId: "A",
    accommodation: "1000.00",
    cleaning: "100.00",
    refunds: "110.00",
    commission: "33.00",
    taxCollected: "30.00",
    taxRemitted: "30.00",
  },
  {
    bookingId: "B",
    accommodation: "600.00",
    cleaning: "60.00",
    commission: "19.80",
    taxCollected: "18.00",
    taxRemitted: "18.00",
  },
];

describe("F04 — Airbnb payout reconstruction", () => {
  it("expects a single payout of 1 597,20 for A and B", () => {
    const result = expectedPayout(bookings);
    expect(result.netPayout).toBe("1597.20");
    expect(result.bookings.map((b) => [b.bookingId, b.net])).toEqual([
      ["A", "957.00"],
      ["B", "640.20"],
    ]);
  });

  it("separates gross services, refunds, commissions and third-party taxes", () => {
    const result = expectedPayout(bookings);
    expect(result.grossServices).toBe("1760.00");
    expect(result.refunds).toBe("110.00");
    expect(result.netOfRefunds).toBe("1650.00");
    expect(result.commissions).toBe("52.80");
    expect(result.taxCollected).toBe("48.00");
    expect(result.taxRemitted).toBe("48.00");
    expect(result.taxFlow).toBe("0.00");
  });

  it("recognises 1 650 of revenue, never the net payout on top of it", () => {
    const result = expectedPayout(bookings);
    expect(result.revenueRecognised).toBe("1650.00");
    expect(result.revenueRecognised).not.toBe("1597.20");
  });

  it("matches one grouped bank line against several bookings", () => {
    expect(matchPayout({ bookings, bankAmount: "1597.20" })).toEqual({
      ok: true,
      kind: "exact",
      netPayout: "1597.20",
      bookingIds: ["A", "B"],
    });
  });

  it("reports the difference when the payout does not match", () => {
    const result = matchPayout({ bookings, bankAmount: "1600.00" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("payout_mismatch");
    expect(result.ok === false && result.difference).toBe("2.80");
  });

  it("is stable on replay", () => {
    expect(expectedPayout(bookings)).toEqual(expectedPayout(bookings));
    expect(bookingLine(bookings[0] as Booking).net).toBe("957.00");
  });
});
