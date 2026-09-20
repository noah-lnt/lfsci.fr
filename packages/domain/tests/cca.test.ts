import { describe, expect, it } from "vitest";
import { buildCcaLedger, type CcaMovement, economicCost } from "../src/cca";

const movements: CcaMovement[] = [
  {
    id: "mv-1",
    date: "2026-01-10",
    kind: "personal_expense",
    amount: "120.00",
    justificationIds: ["ticket-1"],
  },
  { id: "mv-2", date: "2026-02-05", kind: "reimbursement", amount: "80.00" },
];

describe("F02 — personal purchase and partner current account", () => {
  it("books a 120 expense and owes 40 to the partner", () => {
    const ledger = buildCcaLedger(movements);
    expect(ledger.entries.map((e) => [e.id, e.balance, e.expense, e.cash])).toEqual([
      ["mv-1", "120.00", "120.00", "0.00"],
      ["mv-2", "40.00", "0.00", "-80.00"],
    ]);
    expect(ledger.balance).toBe("40.00");
    expect(ledger.totalExpense).toBe("120.00");
    expect(ledger.totalCash).toBe("-80.00");
    expect(ledger.direction).toBe("owed_to_partner");
  });

  it("never turns the reimbursement into a second expense", () => {
    const ledger = buildCcaLedger(movements);
    expect(ledger.totalExpense).not.toBe("200.00");
    expect(ledger.entries[1]?.expense).toBe("0.00");
  });

  it("keeps the valued time in an identified simulation only", () => {
    expect(economicCost({ accountingCost: "120.00", hours: "4", hourlyRate: "50" })).toEqual({
      accountingCost: "120.00",
      valuedTime: "200.00",
      economicCost: "320.00",
      simulationOnly: true,
    });
    expect(buildCcaLedger(movements).totalExpense).toBe("120.00");
  });

  it("orders by date then id and is stable on replay", () => {
    const shuffled = buildCcaLedger([...movements].reverse());
    expect(shuffled).toEqual(buildCcaLedger(movements));
  });

  it("books a contribution and interest as a debt of the SCI", () => {
    const ledger = buildCcaLedger([
      { id: "a", date: "2026-01-01", kind: "contribution", amount: "1000.00" },
      { id: "b", date: "2026-12-31", kind: "interest", amount: "20.00" },
    ]);
    expect(ledger.balance).toBe("1020.00");
    expect(ledger.totalExpense).toBe("20.00");
  });

  it("flags a debit balance", () => {
    const ledger = buildCcaLedger([
      { id: "a", date: "2026-01-01", kind: "reimbursement", amount: "50.00" },
    ]);
    expect(ledger.direction).toBe("owed_by_partner");
    expect(ledger.balance).toBe("-50.00");
  });
});
