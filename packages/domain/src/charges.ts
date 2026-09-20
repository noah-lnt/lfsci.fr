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

export type AllocationKeyTotal = { total: string; exact: boolean };

// CHA-01: an active key version totals exactly 100 % of the amount to spread.
export function allocationKeyTotal(shares: readonly { share: string }[]): AllocationKeyTotal {
  const total = sum(shares.map((s) => decimal(s.share)));
  return { total: total.toFixed(6), exact: total.equals(1) };
}

export type ChargePosting = {
  chargeId: string;
  label: string;
  recoverableAmount: string;
  lotId?: string | undefined;
  key?: AllocationKey | undefined;
};

export type RegularisationOccupancy = Occupancy & { lotId: string };

export type SpreadLot = {
  lotId: string;
  amount: string;
  periodDays: number;
  vacancyDays: number;
  tenants: { tenantId: string; days: number; amount: string }[];
  ownerAmount: string;
};

export type SpreadPosting = {
  chargeId: string;
  label: string;
  recoverableAmount: string;
  keyVersion: number | null;
  lots: SpreadLot[];
};

export type ChargeSpreadBlockedReason =
  | "empty_key"
  | "key_shares_not_exact"
  | "occupancy_exceeds_period"
  | "posting_without_target";

export type ChargeSpread =
  | {
      ok: true;
      postings: SpreadPosting[];
      byTenant: { tenantId: string; amount: string }[];
      ownerAmount: string;
      total: string;
    }
  | Blocked<ChargeSpreadBlockedReason>;

/**
 * CHA-02: one recoverable charge becomes lot shares through its key version,
 * then occupant shares through the occupancy days; what no occupant carries is
 * the owner's vacancy share, never silently redistributed.
 */
export function spreadRecoverableCharges(input: {
  period: DateRange;
  postings: readonly ChargePosting[];
  occupancies: readonly RegularisationOccupancy[];
}): ChargeSpread {
  const postings: SpreadPosting[] = [];
  const perTenant = new Map<string, Decimal>();
  let owner = ZERO;

  for (const posting of input.postings) {
    let lotAmounts: { lotId: string; amount: string }[];
    let keyVersion: number | null;

    if (posting.lotId !== undefined) {
      lotAmounts = [{ lotId: posting.lotId, amount: toMoney(money(posting.recoverableAmount)) }];
      keyVersion = null;
    } else if (posting.key !== undefined) {
      const allocated = allocateExpense({ amount: posting.recoverableAmount, key: posting.key });
      if (!allocated.ok) return blocked(allocated.reason, allocated.missing);
      lotAmounts = allocated.lots;
      keyVersion = allocated.keyVersion;
    } else {
      return blocked("posting_without_target", [posting.chargeId]);
    }

    const lots: SpreadLot[] = [];
    for (const lot of lotAmounts) {
      const split = splitByOccupancy({
        lotId: lot.lotId,
        amount: lot.amount,
        period: input.period,
        occupancies: input.occupancies.filter((occupancy) => occupancy.lotId === lot.lotId),
      });
      if (!split.ok) return blocked(split.reason, split.missing);
      for (const tenant of split.tenants) {
        perTenant.set(
          tenant.tenantId,
          (perTenant.get(tenant.tenantId) ?? ZERO).plus(money(tenant.amount)),
        );
      }
      owner = owner.plus(money(split.ownerAmount));
      lots.push({
        lotId: lot.lotId,
        amount: lot.amount,
        periodDays: split.periodDays,
        vacancyDays: split.vacancyDays,
        tenants: split.tenants,
        ownerAmount: split.ownerAmount,
      });
    }

    postings.push({
      chargeId: posting.chargeId,
      label: posting.label,
      recoverableAmount: toMoney(money(posting.recoverableAmount)),
      keyVersion,
      lots,
    });
  }

  const byTenant = [...perTenant.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tenantId, value]) => ({ tenantId, amount: toMoney(value) }));

  return {
    ok: true,
    postings,
    byTenant,
    ownerAmount: toMoney(owner),
    total: toMoney(sum([...byTenant.map((entry) => money(entry.amount)), owner])),
  };
}
