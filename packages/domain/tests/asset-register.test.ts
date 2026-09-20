import { describe, expect, it } from "vitest";
import {
  annualDepreciation,
  assetRegister,
  DEFAULT_DURATION_YEARS,
  type RegisterComponent,
  resolveDepreciationMonths,
} from "../src/assets";
import { money, sum, toMoney } from "../src/money";

const land: RegisterComponent = {
  id: "land",
  label: "Terrain",
  kind: "land",
  gross: "60000.00",
  startDate: "2020-01-01",
  durationYears: "30",
};

const building: RegisterComponent = {
  id: "building",
  label: "Construction",
  kind: "building",
  gross: "240000.00",
  startDate: "2020-01-01",
  durationYears: "30",
};

describe("IMM-01 — the register the assets screen shows", () => {
  it("excludes land from the depreciable base whatever its stated duration", () => {
    const register = assetRegister({ asOf: "2030-01-01", components: [land, building] });
    expect(register.gross).toBe("300000.00");
    expect(register.land).toBe("60000.00");
    expect(register.depreciableGross).toBe("240000.00");
    const landLine = register.lines.find((line) => line.id === "land");
    expect(landLine?.accumulated).toBe("0.00");
    expect(landLine?.netBookValue).toBe("60000.00");
  });

  it("depreciates the construction straight line and nets it off the gross value", () => {
    const register = assetRegister({ asOf: "2029-12-31", components: [land, building] });
    // Ten years of a thirty-year duration, to the day: a third of 240 000.
    expect(register.accumulated).toBe("80000.00");
    expect(register.netBookValue).toBe("220000.00");
  });

  it("keeps the total equal to the sum of its lines", () => {
    const register = assetRegister({ asOf: "2028-06-30", components: [land, building] });
    expect(register.netBookValue).toBe(
      toMoney(sum(register.lines.map((line) => money(line.netBookValue)))),
    );
  });

  it("says when a duration came from the house default rather than the asset", () => {
    const register = assetRegister({
      asOf: "2030-01-01",
      components: [{ ...building, durationYears: null }],
    });
    expect(register.usesDefaultDuration).toBe(true);
    expect(register.lines[0]?.durationSource).toBe("default");
    expect(register.lines[0]?.durationYears).toBe(DEFAULT_DURATION_YEARS.building);
  });

  it("leaves a component with no commissioning date at its gross value", () => {
    const register = assetRegister({
      asOf: "2030-01-01",
      components: [{ ...building, startDate: null }],
    });
    expect(register.lines[0]?.computable).toBe(false);
    expect(register.lines[0]?.accumulated).toBe("0.00");
    expect(register.netBookValue).toBe("240000.00");
  });

  it("never invents a duration for land", () => {
    expect(resolveDepreciationMonths({ kind: "land", durationYears: "30" })).toEqual({
      months: 0,
      years: 0,
      source: "none",
    });
  });

  it("prefers the duration entered on the asset over the default", () => {
    expect(resolveDepreciationMonths({ kind: "building", durationYears: "25" })).toEqual({
      months: 300,
      years: 25,
      source: "asset",
    });
  });
});

describe("IMM-01 — the yearly depreciation the chart draws", () => {
  it("spreads a mid-year commissioning over one more year than the duration", () => {
    const years = annualDepreciation([
      { ...building, startDate: "2020-07-01", durationYears: "10" },
    ]);
    expect(years[0]?.year).toBe(2020);
    expect(years.at(-1)?.year).toBe(2030);
    expect(years.at(-1)?.cumulative).toBe("240000.00");
  });

  it("ignores land entirely", () => {
    expect(annualDepreciation([land])).toEqual([]);
  });

  it("keeps the first and last year at a prorata of a full one", () => {
    const years = annualDepreciation([
      { ...building, startDate: "2020-07-01", durationYears: "10" },
    ]);
    const full = years.find((year) => year.year === 2025)?.amount;
    expect(Number(years[0]?.amount)).toBeLessThan(Number(full));
    expect(Number(years.at(-1)?.amount)).toBeLessThan(Number(full));
  });
});
