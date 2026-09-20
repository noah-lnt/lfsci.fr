import { describe, expect, it } from "vitest";
import { generateRentTerms, type LeaseTerms, termIdentity } from "../src/rent-terms";

const year = { start: "2026-01-01", end: "2026-12-31" };

const lease: LeaseTerms = {
  leaseId: "lease-1",
  start: "2026-01-15",
  end: "2026-04-10",
  dueDay: 5,
  versions: [
    {
      effectiveFrom: "2026-01-15",
      rentExclCharges: "900.00",
      charges: { kind: "provision", amount: "100.00" },
    },
  ],
};

describe("LOY-01 — rent term generation", () => {
  it("prorates the first and last partial months on actual days", () => {
    const terms = generateRentTerms(lease, year);
    expect(
      terms.map((t) => [t.periodStart, t.periodEnd, t.rent, t.charges, t.total, t.prorated]),
    ).toEqual([
      ["2026-01-15", "2026-01-31", "493.55", "54.84", "548.39", true],
      ["2026-02-01", "2026-02-28", "900.00", "100.00", "1000.00", false],
      ["2026-03-01", "2026-03-31", "900.00", "100.00", "1000.00", false],
      ["2026-04-01", "2026-04-10", "300.00", "33.33", "333.33", true],
    ]);
  });

  it("uses a due day clamped inside the period", () => {
    const terms = generateRentTerms(lease, year);
    expect(terms.map((t) => t.dueDate)).toEqual([
      "2026-01-15",
      "2026-02-05",
      "2026-03-05",
      "2026-04-05",
    ]);
    const lateDue = generateRentTerms({ ...lease, dueDay: 31 }, year);
    expect(lateDue[3]?.dueDate).toBe("2026-04-30");
  });

  it("keys each term on (leaseId, kind, periodStart)", () => {
    const ids = generateRentTerms(lease, year).map(termIdentity);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("lease-1:rent:2026-01-15");
  });

  it("is deterministic on replay", () => {
    expect(generateRentTerms(lease, year)).toEqual(generateRentTerms(lease, year));
  });

  it("turns a mid-month rent change into a new version, not a second term", () => {
    const revised: LeaseTerms = {
      leaseId: "lease-2",
      start: "2026-01-01",
      end: "2026-03-31",
      dueDay: 1,
      versions: [
        {
          effectiveFrom: "2026-01-01",
          rentExclCharges: "900.00",
          charges: { kind: "provision", amount: "0.00" },
        },
        {
          effectiveFrom: "2026-02-15",
          rentExclCharges: "1000.00",
          charges: { kind: "provision", amount: "0.00" },
        },
      ],
    };
    const terms = generateRentTerms(revised, year);
    expect(terms).toHaveLength(3);
    expect(terms.map((t) => [t.periodStart, t.rent, t.version])).toEqual([
      ["2026-01-01", "900.00", 1],
      ["2026-02-01", "950.00", 2],
      ["2026-03-01", "1000.00", 2],
    ]);
  });

  it("keeps the lease prorata when the window starts later", () => {
    const terms = generateRentTerms(lease, { start: "2026-03-01", end: "2026-12-31" });
    expect(terms.map((t) => t.periodStart)).toEqual(["2026-03-01", "2026-04-01"]);
  });

  it("handles a flat charge and an open-ended lease", () => {
    const flat: LeaseTerms = {
      leaseId: "lease-3",
      start: "2026-11-01",
      dueDay: 1,
      versions: [
        {
          effectiveFrom: "2026-11-01",
          rentExclCharges: "500.00",
          charges: { kind: "flat", amount: "50.00" },
        },
      ],
    };
    const terms = generateRentTerms(flat, year);
    expect(terms.map((t) => [t.periodStart, t.chargeKind, t.total])).toEqual([
      ["2026-11-01", "flat", "550.00"],
      ["2026-12-01", "flat", "550.00"],
    ]);
  });
});
