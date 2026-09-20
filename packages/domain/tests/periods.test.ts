import { describe, expect, it } from "vitest";
import { toMoney } from "../src/money";
import {
  addMonthsIso,
  daysBetween,
  daysInMonthOf,
  formatIsoDate,
  monthEndOf,
  monthlyPeriods,
  overlapDays,
  parseIsoDate,
  previousDay,
  prorataFactor,
} from "../src/periods";

describe("calendar dates", () => {
  it("round-trips a date", () => {
    expect(formatIsoDate(parseIsoDate("2028-02-29"))).toBe("2028-02-29");
    expect(() => parseIsoDate("2026-02-29")).toThrow();
    expect(() => parseIsoDate("2026-13-01")).toThrow();
  });

  it("counts days inclusively", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(31);
    expect(daysBetween("2026-01-31", "2026-01-01")).toBe(0);
  });

  it("knows 31, 30, 28 and 29 day months", () => {
    expect(daysInMonthOf("2026-01-10")).toBe(31);
    expect(daysInMonthOf("2026-04-10")).toBe(30);
    expect(daysInMonthOf("2026-02-10")).toBe(28);
    expect(daysInMonthOf("2028-02-10")).toBe(29);
    expect(monthEndOf("2026-02-10")).toBe("2026-02-28");
    expect(monthEndOf("2028-02-10")).toBe("2028-02-29");
  });

  it("steps months and days without drifting", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2028-01-31", 1)).toBe("2028-02-29");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });
});

describe("timezone irrelevance of calendar dates", () => {
  const cases = ["UTC", "Pacific/Auckland", "America/Santiago", "America/Los_Angeles"];

  it("gives the same day counts across DST transitions in any timezone", () => {
    const original = process.env.TZ;
    try {
      for (const tz of cases) {
        process.env.TZ = tz;
        // Santiago springs forward at 00:00 on 2026-09-06: local midnight does not exist.
        expect(daysBetween("2026-09-05", "2026-09-07")).toBe(3);
        expect(daysBetween("2026-03-28", "2026-03-30")).toBe(3);
        expect(daysBetween("2026-10-31", "2026-11-02")).toBe(3);
        expect(formatIsoDate(parseIsoDate("2026-09-06"))).toBe("2026-09-06");
        expect(monthlyPeriods({ start: "2026-09-01", end: "2026-09-30" })[0]?.days).toBe(30);
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("monthly periods", () => {
  it("splits a mid-month start into partial and full months", () => {
    const periods = monthlyPeriods({ start: "2026-01-15", end: "2026-04-10" });
    expect(periods.map((p) => [p.start, p.end, p.days, p.daysInMonth, p.partial])).toEqual([
      ["2026-01-15", "2026-01-31", 17, 31, true],
      ["2026-02-01", "2026-02-28", 28, 28, false],
      ["2026-03-01", "2026-03-31", 31, 31, false],
      ["2026-04-01", "2026-04-10", 10, 30, true],
    ]);
  });

  it("covers a leap February in full", () => {
    const periods = monthlyPeriods({ start: "2028-02-01", end: "2028-02-29" });
    expect(periods).toHaveLength(1);
    expect(periods[0]?.days).toBe(29);
    expect(periods[0]?.partial).toBe(false);
  });

  it("accepts a count instead of an end date", () => {
    const periods = monthlyPeriods({ start: "2026-01-01", count: 3 });
    expect(periods.map((p) => p.end)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(() => monthlyPeriods({ start: "2026-01-01" })).toThrow();
  });

  it("computes the prorata factor from actual days", () => {
    expect(toMoney(prorataFactor({ days: 17, daysInMonth: 31 }).times(900))).toBe("493.55");
    expect(prorataFactor({ days: 30, daysInMonth: 30 }).toFixed(0)).toBe("1");
  });
});

describe("overlap", () => {
  it("counts overlapping days inclusively", () => {
    const a = { start: "2026-01-01", end: "2026-01-31" };
    expect(overlapDays(a, { start: "2026-01-16", end: "2026-02-15" })).toBe(16);
    expect(overlapDays(a, { start: "2026-02-01", end: "2026-02-15" })).toBe(0);
    expect(overlapDays(a, a)).toBe(31);
  });
});
