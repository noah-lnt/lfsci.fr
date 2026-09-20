import { describe, expect, it } from "vitest";
import { acquisitionOutcome, type ScenarioAssumptions } from "../src/cashflow";

const base: ScenarioAssumptions = {
  price: "200000.00",
  fees: "16000.00",
  works: "24000.00",
  equity: "40000.00",
  loanAmount: "200000.00",
  loanAnnualRate: "0.036",
  loanMonths: 240,
  expectedRentYearly: "18000.00",
  chargesYearly: "3000.00",
};

describe("ACQ-01 — what a base scenario claims", () => {
  it("adds fees and works to the price and names the financing gap", () => {
    const outcome = acquisitionOutcome(base);
    expect(outcome.totalBudget).toBe("240000.00");
    expect(outcome.financed).toBe("240000.00");
    expect(outcome.financingGap).toBe("0.00");
  });

  it("shows the gap when equity and loan do not cover the budget", () => {
    expect(acquisitionOutcome({ ...base, equity: "10000.00" }).financingGap).toBe("30000.00");
  });

  it("applies vacancy and unpaid rates to the expected rent, never to the yield base", () => {
    const outcome = acquisitionOutcome({ ...base, vacancyRate: "0.05", unpaidRate: "0.02" });
    expect(outcome.effectiveRentYearly).toBe("16740.00");
    expect(outcome.netOperatingIncomeYearly).toBe("13740.00");
    // The gross yield stays on the contractual rent: 18 000 / 240 000.
    expect(outcome.grossYield).toBe("7.50");
  });

  it("subtracts the loan installments from the operating income", () => {
    const outcome = acquisitionOutcome(base);
    expect(Number(outcome.monthlyInstallment)).toBeGreaterThan(0);
    expect(outcome.yearlyCashflow).toBe(
      (15000 - Number(outcome.monthlyInstallment) * 12).toFixed(2),
    );
  });

  it("costs nothing monthly when nothing is borrowed", () => {
    const outcome = acquisitionOutcome({ ...base, loanAmount: "0.00", loanMonths: 0 });
    expect(outcome.monthlyInstallment).toBe("0.00");
    expect(outcome.yearlyCashflow).toBe("15000.00");
  });
});
