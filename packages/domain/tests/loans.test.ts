import { describe, expect, it } from "vitest";
import { applyInstallment, buildSchedule, matchDebit } from "../src/loans";
import { money, sum, toMoney } from "../src/money";

describe("F01 — capital, interest and insurance", () => {
  const input = {
    outstandingPrincipal: "100000.00",
    debitedAmount: "1000.00",
    split: { capital: "700.00", interest: "250.00", insurance: "50.00" },
  };

  it("lowers the debt to 99 300 and books 300 of expense", () => {
    const result = applyInstallment(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principalAfter).toBe("99300.00");
    expect(result.expense).toBe("300.00");
    expect(result.cash).toBe("-1000.00");
    expect(result.capitalRepaid).toBe("700.00");
    expect(result.total).toBe("1000.00");
  });

  it("never counts the capital as an expense", () => {
    const result = applyInstallment(input);
    expect(result.ok && result.expense).not.toBe("1000.00");
  });

  it("is unchanged on replay", () => {
    expect(applyInstallment(input)).toEqual(applyInstallment(input));
  });

  it("refuses components that do not total the debit", () => {
    const result = applyInstallment({
      ...input,
      split: { capital: "700.00", interest: "250.00", insurance: "49.00" },
    });
    expect(result.ok === false && result.reason).toBe("components_do_not_sum");
  });

  it("matches the bank debit exactly or reports the difference", () => {
    expect(matchDebit("1000.00", "1000.00")).toEqual({
      ok: true,
      kind: "exact",
      amount: "1000.00",
    });
    expect(matchDebit("1000.00", "1002.50")).toEqual({
      ok: false,
      reason: "amount_mismatch",
      difference: "2.50",
    });
  });
});

describe("CRE-01 — annuity schedule", () => {
  it("amortises an interest-free loan in equal capital slices", () => {
    const schedule = buildSchedule({
      principal: "12000.00",
      annualNominalRate: "0",
      months: 12,
      firstDueDate: "2026-01-05",
    });
    expect(schedule.installments).toHaveLength(12);
    expect(schedule.installments[0]?.capital).toBe("1000.00");
    expect(schedule.installments[11]?.remainingPrincipal).toBe("0.00");
    expect(schedule.totalCapital).toBe("12000.00");
  });

  it("splits every installment and closes on a zero principal", () => {
    const schedule = buildSchedule({
      principal: "100000.00",
      annualNominalRate: "0.036",
      months: 240,
      insuranceMonthly: "25.00",
      feesMonthly: "1.50",
      firstDueDate: "2026-02-05",
    });
    const last = schedule.installments.at(-1);
    expect(last?.remainingPrincipal).toBe("0.00");
    expect(last?.dueDate).toBe("2046-01-05");
    expect(schedule.totalCapital).toBe("100000.00");
    expect(schedule.totalInsurance).toBe("6000.00");
    expect(schedule.totalFees).toBe("360.00");
    const first = schedule.installments[0];
    expect(first?.interest).toBe("300.00");
    expect(
      toMoney(
        sum([
          money(first?.capital ?? "0.00"),
          money(first?.interest ?? "0.00"),
          money(first?.insurance ?? "0.00"),
          money(first?.fees ?? "0.00"),
        ]),
      ),
    ).toBe(first?.total);
    expect(
      toMoney(
        sum([
          money(schedule.totalCapital),
          money(schedule.totalInterest),
          money(schedule.totalInsurance),
          money(schedule.totalFees),
        ]),
      ),
    ).toBe(schedule.totalPaid);
  });

  it("pays interest only during a partial deferral", () => {
    const schedule = buildSchedule({
      principal: "12000.00",
      annualNominalRate: "0.12",
      months: 14,
      firstDueDate: "2026-01-05",
      deferral: { months: 2, kind: "partial" },
    });
    expect(schedule.installments[0]).toMatchObject({
      capital: "0.00",
      interest: "120.00",
      remainingPrincipal: "12000.00",
      deferred: true,
    });
    expect(schedule.installments[2]?.deferred).toBe(false);
    expect(schedule.totalCapital).toBe("12000.00");
    expect(schedule.installments.at(-1)?.remainingPrincipal).toBe("0.00");
  });

  it("capitalises interest during a total deferral", () => {
    const schedule = buildSchedule({
      principal: "12000.00",
      annualNominalRate: "0.12",
      months: 14,
      firstDueDate: "2026-01-05",
      deferral: { months: 2, kind: "total" },
    });
    expect(schedule.installments[0]).toMatchObject({
      total: "0.00",
      remainingPrincipal: "12120.00",
    });
    expect(schedule.totalCapital).toBe("12241.20");
    expect(schedule.installments.at(-1)?.remainingPrincipal).toBe("0.00");
  });
});
