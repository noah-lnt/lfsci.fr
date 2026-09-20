import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  insuranceBasisOf,
  type LoanInput,
  outstandingPrincipalAt,
  scheduleProgress,
} from "../src/loans";

const base: LoanInput = {
  principal: "120000.00",
  annualNominalRate: "0.036",
  months: 12,
  firstDueDate: "2026-01-05",
};

describe("CRE-02 — which insurance rule a loan follows", () => {
  it("charges the same premium every month on the initial principal", () => {
    const schedule = buildSchedule({
      ...base,
      insurance: { basis: "initial_principal", annualRate: "0.0036" },
    });
    // 120 000 × 0,36 % ÷ 12 = 36,00 every month, capital repayments notwithstanding.
    expect(schedule.installments.map((i) => i.insurance)).toEqual(Array(12).fill("36.00"));
    expect(schedule.totalInsurance).toBe("432.00");
  });

  it("lets the premium fall with the outstanding capital on the other rule", () => {
    const schedule = buildSchedule({
      ...base,
      insurance: { basis: "outstanding_principal", annualRate: "0.0036" },
    });
    const premiums = schedule.installments.map((i) => i.insurance);
    expect(premiums[0]).toBe("36.00");
    expect(Number(premiums.at(-1))).toBeLessThan(Number(premiums[0]));
    expect(Number(schedule.totalInsurance)).toBeLessThan(432);
  });

  it("reads back from the stored schedule which rule produced it", () => {
    const flat = buildSchedule({
      ...base,
      insurance: { basis: "initial_principal", annualRate: "0.0036" },
    });
    const degressive = buildSchedule({
      ...base,
      insurance: { basis: "outstanding_principal", annualRate: "0.0036" },
    });
    const lines = (schedule: typeof flat) =>
      schedule.installments.map((i) => ({
        dueDate: i.dueDate,
        capital: i.capital,
        interest: i.interest,
        insurance: i.insurance,
        fees: i.fees,
        total: i.total,
        remainingPrincipal: i.remainingPrincipal,
      }));
    expect(insuranceBasisOf(lines(flat))).toBe("initial_principal");
    expect(insuranceBasisOf(lines(degressive))).toBe("outstanding_principal");
    expect(insuranceBasisOf(lines(buildSchedule(base)))).toBe("none");
  });

  it("refuses to name a rule for a schedule whose premium moves both ways", () => {
    expect(
      insuranceBasisOf([
        {
          dueDate: "2026-01-05",
          capital: "0",
          interest: "0",
          insurance: "10.00",
          fees: "0",
          total: "10.00",
        },
        {
          dueDate: "2026-02-05",
          capital: "0",
          interest: "0",
          insurance: "8.00",
          fees: "0",
          total: "8.00",
        },
        {
          dueDate: "2026-03-05",
          capital: "0",
          interest: "0",
          insurance: "12.00",
          fees: "0",
          total: "12.00",
        },
      ]),
    ).toBe("unknown");
  });
});

describe("CRE-01 — outstanding capital and progress", () => {
  const schedule = buildSchedule(base);
  const lines = schedule.installments.map((i) => ({
    dueDate: i.dueDate,
    capital: i.capital,
    interest: i.interest,
    insurance: i.insurance,
    fees: i.fees,
    total: i.total,
    remainingPrincipal: i.remainingPrincipal,
  }));

  it("is the borrowed capital before the first due date", () => {
    expect(
      outstandingPrincipalAt({ principal: "120000.00", installments: lines, on: "2025-12-31" }),
    ).toBe("120000.00");
  });

  it("is nil once the last installment has fallen due", () => {
    expect(
      outstandingPrincipalAt({ principal: "120000.00", installments: lines, on: "2027-01-01" }),
    ).toBe("0.00");
  });

  it("counts what is repaid and what is left at a date inside the schedule", () => {
    const progress = scheduleProgress({
      principal: "120000.00",
      installments: lines,
      on: "2026-06-30",
    });
    expect(progress.installmentsPaid).toBe(6);
    expect(progress.installmentsLeft).toBe(6);
    expect(progress.nextDueOn).toBe("2026-07-05");
    expect(Number(progress.capitalRepaid)).toBeGreaterThan(0);
    expect(progress.outstandingPrincipal).toBe(
      (120000 - Number(progress.capitalRepaid)).toFixed(2),
    );
  });
});
