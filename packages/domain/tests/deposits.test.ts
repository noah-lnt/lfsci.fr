import { describe, expect, it } from "vitest";
import { settleDeposit } from "../src/deposits";

const base = {
  depositHeld: "900.00",
  deductions: [{ id: "ded-1", amount: "150.00", justificationIds: ["inv-1"], alreadyBooked: true }],
  exitInspectionConforms: true,
  keyHandoverDate: "2026-06-15",
};

describe("F10 — deposit and authorised deduction", () => {
  it("restitutes 750 and closes the deposit", () => {
    const result = settleDeposit(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalDeductions).toBe("150.00");
    expect(result.restitution).toBe("750.00");
    expect(result.deductions[0]?.alreadyBooked).toBe(true);
  });

  it("gives one month when the exit inspection conforms", () => {
    const result = settleDeposit(base);
    expect(result.ok && result.deadlineMonths).toBe(1);
    expect(result.ok && result.deadline).toBe("2026-07-15");
  });

  it("gives two months otherwise", () => {
    const result = settleDeposit({ ...base, exitInspectionConforms: false });
    expect(result.ok && result.deadlineMonths).toBe(2);
    expect(result.ok && result.deadline).toBe("2026-08-15");
  });

  it("blocks a deduction without justification instead of offsetting it", () => {
    const result = settleDeposit({
      ...base,
      deductions: [{ id: "ded-2", amount: "150.00", justificationIds: [] }],
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("deduction_without_justification");
    expect(result.ok === false && result.missing).toEqual(["ded-2"]);
  });

  it("blocks deductions above the deposit", () => {
    const result = settleDeposit({
      ...base,
      deductions: [{ id: "ded-3", amount: "1000.00", justificationIds: ["inv-2"] }],
    });
    expect(result.ok === false && result.reason).toBe("deductions_exceed_deposit");
  });

  it("restitutes the whole deposit when nothing is deducted", () => {
    const result = settleDeposit({ ...base, deductions: [] });
    expect(result.ok && result.restitution).toBe("900.00");
    expect(result.ok && result.totalDeductions).toBe("0.00");
  });
});
