import { describe, expect, it } from "vitest";
import {
  allocateExpense,
  OWNER_PARTY,
  recoverableSplit,
  regulariseProvisions,
  splitByOccupancy,
} from "../src/charges";
import { money, sum, toMoney } from "../src/money";

const period = { start: "2026-04-01", end: "2026-04-30" };

const key = {
  version: 3,
  shares: [
    { lotId: "A", share: "0.5" },
    { lotId: "B", share: "0.3" },
    { lotId: "C", share: "0.2" },
  ],
};

describe("F05 — common charges, occupancy and vacancy", () => {
  it("allocates 1200 on the versioned key", () => {
    const result = allocateExpense({ amount: "1200.00", key });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keyVersion).toBe(3);
    expect(result.lots).toEqual([
      { lotId: "A", amount: "600.00" },
      { lotId: "B", amount: "360.00" },
      { lotId: "C", amount: "240.00" },
    ]);
    expect(result.total).toBe("1200.00");
  });

  it("blocks a key that does not total exactly 1", () => {
    const result = allocateExpense({
      amount: "1200.00",
      key: { version: 4, shares: [{ lotId: "A", share: "0.999999" }] },
    });
    expect(result.ok === false && result.reason).toBe("key_shares_not_exact");
    expect(allocateExpense({ amount: "10.00", key: { version: 1, shares: [] } })).toMatchObject({
      reason: "empty_key",
    });
  });

  it("charges tenants 600 / 180 / 0 and leaves 420 with the owner", () => {
    const a = splitByOccupancy({
      lotId: "A",
      amount: "600.00",
      period,
      occupancies: [{ tenantId: "A", start: "2026-04-01", end: "2026-04-30" }],
    });
    const b = splitByOccupancy({
      lotId: "B",
      amount: "360.00",
      period,
      occupancies: [{ tenantId: "B", start: "2026-04-01", end: "2026-04-15" }],
    });
    const c = splitByOccupancy({ lotId: "C", amount: "240.00", period, occupancies: [] });
    expect(a.ok && a.tenants[0]?.amount).toBe("600.00");
    expect(a.ok && a.ownerAmount).toBe("0.00");
    expect(b.ok && b.tenants[0]?.days).toBe(15);
    expect(b.ok && b.tenants[0]?.amount).toBe("180.00");
    expect(b.ok && b.ownerAmount).toBe("180.00");
    expect(c.ok && c.vacancyDays).toBe(30);
    expect(c.ok && c.ownerAmount).toBe("240.00");

    const ownerTotal = sum([a, b, c].map((r) => (r.ok ? money(r.ownerAmount) : money("0.00"))));
    expect(toMoney(ownerTotal)).toBe("420.00");
    const grandTotal = sum([a, b, c].map((r) => (r.ok ? money(r.total) : money("0.00"))));
    expect(toMoney(grandTotal)).toBe("1200.00");
    expect(OWNER_PARTY).toBe("__owner__");
  });

  it("regularises against provisions called: A owes 100, B is credited 20, net 80", () => {
    const result = regulariseProvisions([
      {
        tenantId: "A",
        recoverableCost: "600.00",
        provisionsCalled: "500.00",
        provisionsPaid: "500.00",
      },
      {
        tenantId: "B",
        recoverableCost: "180.00",
        provisionsCalled: "200.00",
        provisionsPaid: "200.00",
      },
    ]);
    expect(result.lines.map((l) => [l.tenantId, l.balance, l.direction])).toEqual([
      ["A", "100.00", "tenant_owes"],
      ["B", "-20.00", "tenant_credit"],
    ]);
    expect(result.netBalance).toBe("80.00");
  });

  it("splits a partially recoverable expense", () => {
    expect(recoverableSplit({ amount: "1000.00", recoverableRate: "0.75" })).toEqual({
      recoverable: "750.00",
      owner: "250.00",
    });
  });

  it("refuses overlapping occupancies beyond the period", () => {
    const result = splitByOccupancy({
      lotId: "A",
      amount: "600.00",
      period,
      occupancies: [
        { tenantId: "A", start: "2026-04-01", end: "2026-04-30" },
        { tenantId: "B", start: "2026-04-01", end: "2026-04-30" },
      ],
    });
    expect(result.ok === false && result.reason).toBe("occupancy_exceeds_period");
  });
});

describe("T-F11 — provisions called but unpaid", () => {
  it("keeps the 300 unpaid provisions separate from the 100 regularisation", () => {
    const result = regulariseProvisions([
      {
        tenantId: "A",
        recoverableCost: "1300.00",
        provisionsCalled: "1200.00",
        provisionsPaid: "900.00",
      },
    ]);
    expect(result.lines[0]?.balance).toBe("100.00");
    expect(result.lines[0]?.unpaidProvisions).toBe("300.00");
    expect(result.lines[0]?.totalReceivable).toBe("400.00");
    expect(result.netReceivable).toBe("400.00");
    expect(result.netReceivable).not.toBe("700.00");
  });

  it("never regularises a flat charge", () => {
    const result = regulariseProvisions([
      {
        tenantId: "A",
        kind: "flat",
        recoverableCost: "1300.00",
        provisionsCalled: "1200.00",
        provisionsPaid: "1200.00",
      },
    ]);
    expect(result.lines).toEqual([]);
    expect(result.netBalance).toBe("0.00");
  });
});
