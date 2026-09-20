import { describe, expect, it } from "vitest";
import { type AccountMovement, bankBalanceAt } from "../src/cashflow";

const ledger: AccountMovement[] = [
  { bookedOn: "2026-02-10", amount: "1200.00", fromLedger: true },
  { bookedOn: "2026-03-05", amount: "-450.50", fromLedger: true },
];

describe("BAN-01 — where a bank balance comes from", () => {
  it("adds the ledger movements to the opening balance and says so", () => {
    const balance = bankBalanceAt({
      openingBalance: "10000.00",
      openingBalanceOn: "2026-01-31",
      movements: ledger,
      asOf: "2026-03-31",
    });
    expect(balance.balance).toBe("10749.50");
    expect(balance.basis).toBe("ledger");
    expect(balance.asOf).toBe("2026-03-05");
    expect(balance.ledgerMovements).toBe(2);
  });

  it("falls back to a computed balance as soon as one line is not the ledger's", () => {
    const balance = bankBalanceAt({
      openingBalance: "10000.00",
      openingBalanceOn: "2026-01-31",
      movements: [...ledger, { bookedOn: "2026-03-20", amount: "-100.00", fromLedger: false }],
      asOf: "2026-03-31",
    });
    expect(balance.basis).toBe("computed");
    expect(balance.importedMovements).toBe(1);
    expect(balance.balance).toBe("10649.50");
  });

  it("reports the opening balance alone when nothing has been mirrored yet", () => {
    const balance = bankBalanceAt({
      openingBalance: "10000.00",
      openingBalanceOn: "2026-01-31",
      movements: [],
      asOf: "2026-03-31",
    });
    expect(balance.basis).toBe("opening_only");
    expect(balance.balance).toBe("10000.00");
    expect(balance.asOf).toBe("2026-01-31");
  });

  it("ignores movements already inside the opening balance or after the asked date", () => {
    const balance = bankBalanceAt({
      openingBalance: "10000.00",
      openingBalanceOn: "2026-02-10",
      movements: [...ledger, { bookedOn: "2026-12-01", amount: "5000.00", fromLedger: true }],
      asOf: "2026-03-31",
    });
    expect(balance.movements).toBe(1);
    expect(balance.balance).toBe("9549.50");
  });
});
