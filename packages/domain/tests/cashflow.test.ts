import { describe, expect, it } from "vitest";
import { applyInternalTransfer, type PeriodFacts, resultToCash } from "../src/cashflow";

const facts: PeriodFacts = {
  openingBank: "2000.00",
  incomeAccrued: "12000.00",
  incomeCollected: "10800.00",
  operatingExpenses: "4000.00",
  operatingExpensesPaid: "3500.00",
  interestAccrued: "1000.00",
  interestPaid: "1000.00",
  depreciation: "2000.00",
  investmentPaid: "5000.00",
  principalRepaid: "3000.00",
  newLoanReceived: "4000.00",
  partnerAccountContribution: "1000.00",
};

describe("F08 — result to cash bridge", () => {
  it("gives a result of 5 000 and a bank movement of 3 300", () => {
    const bridge = resultToCash(facts);
    expect(bridge.result).toBe("5000.00");
    expect(bridge.netBankFlow).toBe("3300.00");
    expect(bridge.closingBank).toBe("5300.00");
  });

  it("explains the whole gap line by line", () => {
    const bridge = resultToCash(facts);
    expect(bridge.bridge).toEqual([
      { label: "result", amount: "5000.00" },
      { label: "depreciation", amount: "2000.00" },
      { label: "receivables_change", amount: "-1200.00" },
      { label: "payables_change", amount: "500.00" },
      { label: "investment", amount: "-5000.00" },
      { label: "principal_repaid", amount: "-3000.00" },
      { label: "new_loan", amount: "4000.00" },
      { label: "partner_account", amount: "1000.00" },
    ]);
    expect(bridge.bridgeTotal).toBe("3300.00");
    expect(bridge.balanced).toBe(true);
  });

  it("never turns a loan or a contribution into income", () => {
    const withoutFinancing = resultToCash({
      ...facts,
      newLoanReceived: "0.00",
      partnerAccountContribution: "0.00",
    });
    expect(withoutFinancing.result).toBe("5000.00");
    expect(withoutFinancing.netBankFlow).toBe("-1700.00");
  });
});

describe("F09 — internal transfer and bank fees", () => {
  const accounts = [
    { accountId: "A", balance: "5000.00" },
    { accountId: "B", balance: "1000.00" },
  ];

  it("leaves A at 3 998, B at 2 000 and moves the consolidated total by the fees only", () => {
    const result = applyInternalTransfer({
      accounts,
      from: "A",
      to: "B",
      amount: "1000.00",
      fees: "2.00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balances).toEqual([
      { accountId: "A", balance: "3998.00" },
      { accountId: "B", balance: "2000.00" },
    ]);
    expect(result.consolidatedAfter).toBe("5998.00");
    expect(result.variation).toBe("-2.00");
    expect(result.expense).toBe("2.00");
    expect(result.income).toBe("0.00");
    expect(result.status).toBe("settled");
  });

  it("shows an in-transit counterpart instead of inventing an anomaly", () => {
    const result = applyInternalTransfer({
      accounts,
      from: "A",
      to: "B",
      amount: "1000.00",
      fees: "2.00",
      creditReceived: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("in_transit");
    expect(result.inTransit).toBe("1000.00");
    expect(result.balances[1]?.balance).toBe("1000.00");
    expect(result.consolidatedAfter).toBe("5998.00");
    expect(result.variation).toBe("-2.00");
    expect(result.income).toBe("0.00");
  });

  it("refuses an unknown or identical account", () => {
    expect(applyInternalTransfer({ accounts, from: "A", to: "Z", amount: "10.00" })).toMatchObject({
      reason: "unknown_account",
      missing: ["Z"],
    });
    expect(applyInternalTransfer({ accounts, from: "A", to: "A", amount: "10.00" })).toMatchObject({
      reason: "same_account",
    });
  });
});
