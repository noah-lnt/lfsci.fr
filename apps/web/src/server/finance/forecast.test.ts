import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { aggregateForecast } = await import("./forecast");

const base = {
  asOf: "2026-09-20",
  currency: "EUR",
  openingBalance: "1000.00",
  missingSources: [],
} as const;

describe("aggregateForecast — TRE-01", () => {
  it("keeps the opening balance as the only realised figure", () => {
    const forecast = aggregateForecast({
      ...base,
      horizonDays: "30",
      events: [{ on: "2026-10-05", amount: "800.00", source: "rent_term" }],
    });
    expect(forecast.openingBalance).toBe("1000.00");
    expect(forecast.buckets[0]?.inflow).toBe("800.00");
    expect(forecast.closingBalance).toBe("1800.00");
  });

  it("runs the balance day by day, in date order", () => {
    const forecast = aggregateForecast({
      ...base,
      horizonDays: "90",
      events: [
        { on: "2026-10-05", amount: "-500.00", source: "loan_installment" },
        { on: "2026-09-25", amount: "800.00", source: "rent_term" },
      ],
    });
    expect(forecast.buckets.map((bucket) => bucket.on)).toEqual(["2026-09-25", "2026-10-05"]);
    expect(forecast.buckets.map((bucket) => bucket.balance)).toEqual(["1800.00", "1300.00"]);
    expect(forecast.buckets[1]?.outflow).toBe("500.00");
  });

  it("drops what falls outside the horizon", () => {
    const forecast = aggregateForecast({
      ...base,
      horizonDays: "30",
      events: [
        { on: "2026-09-19", amount: "100.00", source: "rent_term" },
        { on: "2026-12-01", amount: "100.00", source: "rent_term" },
        { on: "2026-10-01", amount: "100.00", source: "rent_term" },
      ],
    });
    expect(forecast.buckets).toHaveLength(1);
    expect(forecast.buckets[0]?.on).toBe("2026-10-01");
    expect(forecast.closingBalance).toBe("1100.00");
  });

  it("merges a day's movements and lists its sources once", () => {
    const forecast = aggregateForecast({
      ...base,
      horizonDays: "30",
      events: [
        { on: "2026-10-01", amount: "-120.00", source: "expense" },
        { on: "2026-10-01", amount: "-80.00", source: "expense" },
        { on: "2026-10-01", amount: "900.00", source: "rent_term" },
      ],
    });
    expect(forecast.buckets).toHaveLength(1);
    expect(forecast.buckets[0]).toMatchObject({
      inflow: "900.00",
      outflow: "200.00",
      balance: "1700.00",
      sources: ["expense", "rent_term"],
    });
  });

  it("closes on the opening balance when nothing is expected", () => {
    const forecast = aggregateForecast({ ...base, horizonDays: "365", events: [] });
    expect(forecast.buckets).toEqual([]);
    expect(forecast.closingBalance).toBe("1000.00");
  });

  it("reports the sources it could not read", () => {
    const forecast = aggregateForecast({
      ...base,
      horizonDays: "30",
      events: [],
      missingSources: ["comptes bancaires"],
    });
    expect(forecast.missingSources).toEqual(["comptes bancaires"]);
  });
});
