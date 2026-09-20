import { Decimal } from "decimal.js";
import { decimal, money, roundCent, splitByShares, sum, toMoney, ZERO } from "./money";
import { type DateRange, daysBetween, type IsoDateString, overlapRange } from "./periods";
import { type Blocked, blocked } from "./result";

export const OWNER_PARTY = "__owner__";

export type AllocationKey = {
  version: number;
  shares: readonly { lotId: string; share: string }[];
};

export type ExpenseAllocation =
  | { ok: true; keyVersion: number; lots: { lotId: string; amount: string }[]; total: string }
  | Blocked<"empty_key" | "key_shares_not_exact">;

export function allocateExpense(input: { amount: string; key: AllocationKey }): ExpenseAllocation {
  if (input.key.shares.length === 0) return blocked("empty_key", ["key.shares"]);
  const total = sum(input.key.shares.map((s) => decimal(s.share)));
  if (!total.equals(1)) {
    return blocked(
      "key_shares_not_exact",
      input.key.shares.map((s) => s.lotId),
    );
  }
  const parts = splitByShares(
    money(input.amount),
    input.key.shares.map((s) => ({ id: s.lotId, share: s.share })),
  );
  return {
    ok: true,
    keyVersion: input.key.version,
    lots: parts.map((p) => ({ lotId: p.id, amount: toMoney(p.amount) })),
    total: toMoney(sum(parts.map((p) => p.amount))),
  };
}

export function recoverableSplit(input: { amount: string; recoverableRate: string }): {
  recoverable: string;
  owner: string;
} {
  const amount = money(input.amount);
  const recoverable = roundCent(amount.times(decimal(input.recoverableRate)));
  return { recoverable: toMoney(recoverable), owner: toMoney(amount.minus(recoverable)) };
}

export type Occupancy = { tenantId: string; start: IsoDateString; end: IsoDateString };

export type OccupancySplit =
  | {
      ok: true;
      lotId: string;
      periodDays: number;
      vacancyDays: number;
      tenants: { tenantId: string; days: number; amount: string }[];
      ownerAmount: string;
      total: string;
    }
  | Blocked<"occupancy_exceeds_period">;

export function splitByOccupancy(input: {
  lotId: string;
  amount: string;
  period: DateRange;
  occupancies: readonly Occupancy[];
}): OccupancySplit {
  const periodDays = daysBetween(input.period.start, input.period.end);
  const occupied = input.occupancies.map((o) => {
    const slice = overlapRange(input.period, { start: o.start, end: o.end });
    return { tenantId: o.tenantId, days: slice === null ? 0 : daysBetween(slice.start, slice.end) };
  });
  const occupiedDays = occupied.reduce((acc, o) => acc + o.days, 0);
  if (occupiedDays > periodDays) {
    return blocked(
      "occupancy_exceeds_period",
      occupied.map((o) => o.tenantId),
    );
  }
  const vacancyDays = periodDays - occupiedDays;
  const parts = splitByShares(money(input.amount), [
    ...occupied.map((o) => ({ id: o.tenantId, share: String(o.days) })),
    { id: OWNER_PARTY, share: String(vacancyDays) },
  ]);
  const byId = new Map(parts.map((p) => [p.id, p.amount]));
  return {
    ok: true,
    lotId: input.lotId,
    periodDays,
    vacancyDays,
    tenants: occupied.map((o) => ({
      tenantId: o.tenantId,
      days: o.days,
      amount: toMoney(byId.get(o.tenantId) ?? ZERO),
    })),
    ownerAmount: toMoney(byId.get(OWNER_PARTY) ?? ZERO),
    total: toMoney(sum(parts.map((p) => p.amount))),
  };
}

export type RegularisationLine = {
  tenantId: string;
  recoverableCost: string;
  provisionsCalled: string;
  provisionsPaid: string;
  kind?: "provision" | "flat" | undefined;
};

export type RegularisationDirection = "tenant_owes" | "tenant_credit" | "settled";

export type RegularisedLine = {
  tenantId: string;
  recoverableCost: string;
  provisionsCalled: string;
  provisionsPaid: string;
  balance: string;
  direction: RegularisationDirection;
  unpaidProvisions: string;
  totalReceivable: string;
};

// CHA-02: la régularisation compare le coût réel aux provisions APPELÉES ;
// les provisions impayées restent une créance distincte, jamais refacturée.
export function regulariseProvisions(lines: readonly RegularisationLine[]): {
  lines: RegularisedLine[];
  netBalance: string;
  unpaidProvisions: string;
  netReceivable: string;
} {
  const computed = lines
    .filter((line) => (line.kind ?? "provision") === "provision")
    .map((line) => {
      const cost = money(line.recoverableCost);
      const called = money(line.provisionsCalled);
      const paid = money(line.provisionsPaid);
      const balance = cost.minus(called);
      const unpaid = Decimal.max(called.minus(paid), ZERO);
      return {
        tenantId: line.tenantId,
        recoverableCost: toMoney(cost),
        provisionsCalled: toMoney(called),
        provisionsPaid: toMoney(paid),
        balance: toMoney(balance),
        direction: balance.isZero()
          ? ("settled" as const)
          : balance.isPositive()
            ? ("tenant_owes" as const)
            : ("tenant_credit" as const),
        unpaidProvisions: toMoney(unpaid),
        totalReceivable: toMoney(balance.plus(unpaid)),
      };
    });
  return {
    lines: computed,
    netBalance: toMoney(sum(computed.map((l) => money(l.balance)))),
    unpaidProvisions: toMoney(sum(computed.map((l) => money(l.unpaidProvisions)))),
    netReceivable: toMoney(sum(computed.map((l) => money(l.totalReceivable)))),
  };
}
