import { describe, expect, it } from "vitest";
import { allocationKeyTotal, regulariseProvisions, spreadRecoverableCharges } from "../src/charges";
import { proposeRevision } from "../src/irl";
import { money, sum, toMoney } from "../src/money";

const period = { start: "2026-01-01", end: "2026-12-31" };

const key = {
  version: 2,
  shares: [
    { lotId: "A", share: "0.6" },
    { lotId: "B", share: "0.4" },
  ],
};

describe("CHA-01 — key version totals", () => {
  it("accepts a key that totals exactly one and refuses a drifting one", () => {
    expect(allocationKeyTotal(key.shares)).toEqual({ total: "1.000000", exact: true });
    expect(allocationKeyTotal([{ share: "0.5" }, { share: "0.499999" }])).toEqual({
      total: "0.999999",
      exact: false,
    });
  });
});

describe("CHA-02 — recoverable charges spread over lots then occupants", () => {
  it("splits a common charge by key, then by occupancy, leaving the vacancy with the owner", () => {
    const result = spreadRecoverableCharges({
      period,
      postings: [{ chargeId: "c1", label: "Eau froide", recoverableAmount: "1000.00", key }],
      occupancies: [
        { lotId: "A", tenantId: "bail-1", start: "2026-01-01", end: "2026-06-30" },
        { lotId: "A", tenantId: "bail-2", start: "2026-07-01", end: "2026-12-31" },
        { lotId: "B", tenantId: "bail-3", start: "2026-01-01", end: "2026-09-30" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [posting] = result.postings;
    expect(posting?.keyVersion).toBe(2);
    expect(posting?.lots.map((lot) => lot.amount)).toEqual(["600.00", "400.00"]);
    // Lot A is occupied all year by two successive tenants: no vacancy there.
    expect(posting?.lots[0]?.vacancyDays).toBe(0);
    expect(posting?.lots[1]?.vacancyDays).toBe(92);

    expect(result.byTenant).toEqual([
      { tenantId: "bail-1", amount: "297.53" },
      { tenantId: "bail-2", amount: "302.47" },
      { tenantId: "bail-3", amount: "299.18" },
    ]);
    expect(result.ownerAmount).toBe("100.82");
    // Nothing is created or lost by the two successive splits.
    expect(result.total).toBe("1000.00");
    expect(
      toMoney(
        sum([...result.byTenant.map((entry) => money(entry.amount)), money(result.ownerAmount)]),
      ),
    ).toBe("1000.00");
  });

  it("carries a lot-targeted charge straight to its occupants", () => {
    const result = spreadRecoverableCharges({
      period: { start: "2026-01-01", end: "2026-01-31" },
      postings: [
        { chargeId: "c2", label: "Entretien chaudière A", recoverableAmount: "93.00", lotId: "A" },
      ],
      occupancies: [{ lotId: "A", tenantId: "bail-1", start: "2026-01-01", end: "2026-01-31" }],
    });
    expect(result.ok && result.postings[0]?.keyVersion).toBeNull();
    expect(result.ok && result.byTenant).toEqual([{ tenantId: "bail-1", amount: "93.00" }]);
  });

  it("blocks a posting with neither a lot nor a key, and a key that is not exact", () => {
    expect(
      spreadRecoverableCharges({
        period,
        postings: [{ chargeId: "c3", label: "Sans cible", recoverableAmount: "10.00" }],
        occupancies: [],
      }),
    ).toEqual({ ok: false, reason: "posting_without_target", missing: ["c3"] });

    expect(
      spreadRecoverableCharges({
        period,
        postings: [
          {
            chargeId: "c4",
            label: "Clé incomplète",
            recoverableAmount: "10.00",
            key: { version: 1, shares: [{ lotId: "A", share: "0.9" }] },
          },
        ],
        occupancies: [],
      }),
    ).toMatchObject({ ok: false, reason: "key_shares_not_exact" });
  });

  it("leaves a flat-fee lease out of the regularisation", () => {
    const result = regulariseProvisions([
      {
        tenantId: "bail-1",
        recoverableCost: "297.53",
        provisionsCalled: "240.00",
        provisionsPaid: "180.00",
      },
      {
        tenantId: "bail-forfait",
        recoverableCost: "500.00",
        provisionsCalled: "480.00",
        provisionsPaid: "480.00",
        kind: "flat",
      },
    ]);
    expect(result.lines.map((line) => line.tenantId)).toEqual(["bail-1"]);
    expect(result.lines[0]).toMatchObject({
      balance: "57.53",
      direction: "tenant_owes",
      unpaidProvisions: "60.00",
      totalReceivable: "117.53",
    });
  });
});

describe("IRL-01 — the exact quotient is kept beside the rounded rent", () => {
  it("keeps six decimals of the unrounded revision", () => {
    const result = proposeRevision({
      currentRent: "800.00",
      baseIndex: { value: "143.46", quarter: 2, year: 2025 },
      newIndex: { value: "146.12", quarter: 2, year: 2026 },
      clausePresent: true,
      dpeClass: "D",
      territory: "metropole",
      requestDate: "2026-09-20",
      revisionDueDate: "2026-09-01",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newRentUnrounded).toBe("814.833403");
    expect(result.newRent).toBe("814.83");
  });
});
