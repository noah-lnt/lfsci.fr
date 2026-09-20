import { decimal, money, roundCent, sum, toMoney, ZERO } from "./money";
import type { IsoDateString } from "./periods";

export type CcaMovementKind = "contribution" | "personal_expense" | "reimbursement" | "interest";

export type CcaMovement = {
  id: string;
  date: IsoDateString;
  kind: CcaMovementKind;
  amount: string;
  justificationIds?: readonly string[] | undefined;
};

export type CcaEntry = {
  id: string;
  date: IsoDateString;
  kind: CcaMovementKind;
  amount: string;
  balance: string;
  expense: string;
  cash: string;
};

export type CcaLedger = {
  entries: CcaEntry[];
  balance: string;
  totalExpense: string;
  totalCash: string;
  direction: "owed_to_partner" | "owed_by_partner" | "settled";
};

const SIGN: Record<CcaMovementKind, 1 | -1> = {
  contribution: 1,
  personal_expense: 1,
  reimbursement: -1,
  interest: 1,
};

// CCA-02 : le remboursement d'une dette envers l'associé ne crée pas une seconde charge.
export function buildCcaLedger(movements: readonly CcaMovement[]): CcaLedger {
  const ordered = [...movements].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  let balance = ZERO;
  const entries: CcaEntry[] = ordered.map((m) => {
    const amount = money(m.amount);
    balance = balance.plus(amount.times(SIGN[m.kind]));
    const expense = m.kind === "personal_expense" || m.kind === "interest" ? amount : ZERO;
    const cash = m.kind === "reimbursement" ? amount.negated() : ZERO;
    return {
      id: m.id,
      date: m.date,
      kind: m.kind,
      amount: toMoney(amount),
      balance: toMoney(balance),
      expense: toMoney(expense),
      cash: toMoney(cash),
    };
  });
  return {
    entries,
    balance: toMoney(balance),
    totalExpense: toMoney(sum(entries.map((e) => money(e.expense)))),
    totalCash: toMoney(sum(entries.map((e) => money(e.cash)))),
    direction: balance.isZero()
      ? "settled"
      : balance.isPositive()
        ? "owed_to_partner"
        : "owed_by_partner",
  };
}

export type EconomicCost = {
  accountingCost: string;
  valuedTime: string;
  economicCost: string;
  simulationOnly: true;
};

// F02 : le temps personnel n'entre jamais dans le résultat comptable.
export function economicCost(input: {
  accountingCost: string;
  hours: string;
  hourlyRate: string;
}): EconomicCost {
  const accounting = money(input.accountingCost);
  const valued = roundCent(decimal(input.hours).times(decimal(input.hourlyRate)));
  return {
    accountingCost: toMoney(accounting),
    valuedTime: toMoney(valued),
    economicCost: toMoney(accounting.plus(valued)),
    simulationOnly: true,
  };
}
