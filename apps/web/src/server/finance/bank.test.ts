import { describe, expect, it, vi } from "vitest";
import type { AccountBalance } from "@/lib/contracts/finance";

vi.mock("server-only", () => ({}));

const { consolidatedBasis } = await import("./bank");

function balance(basis: AccountBalance["basis"]): AccountBalance {
  return {
    bankAccountId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    label: "Compte",
    balance: "100.00",
    currency: "EUR",
    asOf: "2026-09-20",
    basis,
    source: basis === "ledger" ? "odoo" : "saas_projection",
    readAt: null,
    movements: 1,
    ledgerMovements: basis === "ledger" ? 1 : 0,
    importedMovements: basis === "ledger" ? 0 : 1,
  };
}

describe("BAN-01 — the consolidated figure carries its weakest basis", () => {
  it("is the ledger's only when every account is", () => {
    expect(consolidatedBasis([balance("ledger"), balance("ledger")])).toBe("ledger");
  });

  it("falls to computed as soon as one account is computed", () => {
    expect(consolidatedBasis([balance("ledger"), balance("computed")])).toBe("computed");
  });

  it("stays ledger when the other account has no movement at all", () => {
    expect(consolidatedBasis([balance("ledger"), balance("opening_only")])).toBe("ledger");
  });

  it("says opening_only when nothing has been mirrored anywhere", () => {
    expect(consolidatedBasis([balance("opening_only")])).toBe("opening_only");
    expect(consolidatedBasis([])).toBe("opening_only");
  });
});

const { resolveAccountBalance } = await import("./bank");

const account = {
  id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  label: "Compte",
  currency: "EUR",
  openingBalance: "1000.00",
  openingBalanceOn: "2026-01-01",
  odooBalance: null,
  odooBalanceOn: null,
  odooReadAt: null,
  lastMovementReadAt: null,
};
const lines = [{ bookedOn: "2026-02-01", amount: "250.00", fromLedger: false }];

describe("BAN-01 — the ledger's own balance wins over the reconstruction", () => {
  it("shows Odoo's figure at its own date when the copy is not later than the request", () => {
    const resolved = resolveAccountBalance(
      {
        ...account,
        odooBalance: "1310.55",
        odooBalanceOn: "2026-03-01",
        odooReadAt: "2026-03-02T05:00:00.000Z",
      },
      lines,
      "2026-03-15",
    );
    expect(resolved).toMatchObject({
      balance: "1310.55",
      asOf: "2026-03-01",
      basis: "ledger",
      source: "odoo",
      readAt: "2026-03-02T05:00:00.000Z",
    });
  });

  it("falls back to the labelled reconstruction when the ledger has not answered", () => {
    const resolved = resolveAccountBalance(account, lines, "2026-03-15");
    expect(resolved).toMatchObject({
      balance: "1250.00",
      basis: "computed",
      source: "saas_projection",
    });
  });

  it("ignores a ledger balance dated after the requested date", () => {
    const resolved = resolveAccountBalance(
      { ...account, odooBalance: "9999.00", odooBalanceOn: "2026-04-01" },
      lines,
      "2026-03-15",
    );
    expect(resolved).toMatchObject({ balance: "1250.00", basis: "computed" });
  });
});

const { insuranceBasisMismatch } = await import("./loans");

describe("CRE-02 — the stored insurance rule against the observed premiums", () => {
  it("reports a disagreement between the two known rules", () => {
    expect(insuranceBasisMismatch("initial_principal", "outstanding_principal")).toBe(true);
  });

  it("stays quiet when they agree or when the premiums fit neither rule", () => {
    expect(insuranceBasisMismatch("initial_principal", "initial_principal")).toBe(false);
    expect(insuranceBasisMismatch("initial_principal", "unknown")).toBe(false);
    expect(insuranceBasisMismatch("outstanding_principal", "none")).toBe(false);
  });
});
