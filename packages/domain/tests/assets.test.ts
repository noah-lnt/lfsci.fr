import { describe, expect, it } from "vitest";
import {
  accumulatedAt,
  assetPosition,
  type DepreciableComponent,
  depreciationBetween,
  isDepreciable,
  netBookValueAt,
  straightLineSchedule,
} from "../src/assets";
import { money, sum, toMoney } from "../src/money";

const building: DepreciableComponent = {
  id: "building",
  kind: "building",
  gross: "80000.00",
  startDate: "2026-01-01",
  months: 300,
};

const land: DepreciableComponent = {
  id: "land",
  kind: "land",
  gross: "20000.00",
  startDate: "2026-01-01",
  months: 0,
};

describe("F07 — asset, depreciation, NBV and market value", () => {
  it("never depreciates land", () => {
    expect(isDepreciable("land")).toBe(false);
    expect(straightLineSchedule(land)).toEqual([]);
    expect(accumulatedAt(land, "2099-12-31")).toBe("0.00");
    expect(netBookValueAt(land, "2099-12-31")).toBe("20000.00");
  });

  it("gives NBV 98 000, accounting equity 38 000 and economic net value 60 000", () => {
    const position = assetPosition({
      components: [
        { id: "land", kind: "land", gross: "20000.00", accumulated: "0.00" },
        { id: "building", kind: "building", gross: "80000.00", accumulated: "2000.00" },
      ],
      debts: "60000.00",
      marketValue: "120000.00",
    });
    expect(position.gross).toBe("100000.00");
    expect(position.accumulatedDepreciation).toBe("2000.00");
    expect(position.netBookValue).toBe("98000.00");
    expect(position.accountingEquity).toBe("38000.00");
    expect(position.economicNetValue).toBe("60000.00");
    expect(position.economicNetValueIsBeforeDisposalCostsAndTax).toBe(true);
    expect(position.components[0]?.nbv).toBe("20000.00");
    expect(position.components[1]?.nbv).toBe("78000.00");
  });

  it("keeps a market re-estimation out of the books", () => {
    const at = (marketValue: string) =>
      assetPosition({
        components: [
          { id: "building", kind: "building", gross: "80000.00", accumulated: "2000.00" },
        ],
        debts: "60000.00",
        marketValue,
      });
    expect(at("120000.00").netBookValue).toBe(at("150000.00").netBookValue);
    expect(at("150000.00").economicNetValue).toBe("90000.00");
  });
});

describe("straight-line depreciation", () => {
  it("charges 3 200 over the first full year", () => {
    expect(depreciationBetween(building, { start: "2026-01-01", end: "2026-12-31" })).toBe(
      "3200.00",
    );
    expect(accumulatedAt(building, "2026-12-31")).toBe("3200.00");
    expect(netBookValueAt(building, "2026-12-31")).toBe("76800.00");
  });

  it("totals exactly the gross value over the life of the component", () => {
    const schedule = straightLineSchedule(building);
    expect(schedule).toHaveLength(300);
    expect(toMoney(sum(schedule.map((s) => money(s.amount))))).toBe("80000.00");
    expect(accumulatedAt(building, "2050-12-31")).toBe("80000.00");
    expect(netBookValueAt(building, "2050-12-31")).toBe("0.00");
    expect(accumulatedAt(building, "2060-12-31")).toBe("80000.00");
  });

  it("prorates a mid-month commissioning on actual days", () => {
    const works: DepreciableComponent = {
      id: "works",
      kind: "works",
      gross: "12000.00",
      startDate: "2026-01-15",
      months: 12,
    };
    // 17 of 31 January days = 17/31 of a month out of 12.
    expect(accumulatedAt(works, "2026-01-31")).toBe("548.39");
    expect(straightLineSchedule(works).at(0)?.amount).toBe("548.39");
    expect(accumulatedAt(works, "2027-01-14")).toBe("12000.00");
    expect(toMoney(sum(straightLineSchedule(works).map((s) => money(s.amount))))).toBe("12000.00");
  });

  it("charges nothing before the start date", () => {
    expect(accumulatedAt(building, "2025-12-31")).toBe("0.00");
    expect(depreciationBetween(building, { start: "2025-01-01", end: "2025-12-31" })).toBe("0.00");
  });
});
