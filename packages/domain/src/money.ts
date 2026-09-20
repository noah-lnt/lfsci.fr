import { Decimal } from "decimal.js";

export type { Decimal } from "decimal.js";

const MONEY_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;
const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,12})?$/;

export const CENT = new Decimal("0.01");
export const ZERO = new Decimal(0);

export function money(value: string): Decimal {
  if (!MONEY_PATTERN.test(value)) {
    throw new TypeError(`invalid money string: ${value}`);
  }
  return new Decimal(value);
}

export function decimal(value: string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (!DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`invalid decimal string: ${value}`);
  }
  return new Decimal(value);
}

export function roundCent(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function toMoney(value: Decimal): string {
  return roundCent(value).toFixed(2);
}

export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);
}

export function mul(amount: Decimal, factor: Decimal | string): Decimal {
  return amount.times(decimal(factor));
}

export function div(amount: Decimal, divisor: Decimal | string): Decimal {
  return amount.dividedBy(decimal(divisor));
}

export function neg(value: Decimal): Decimal {
  return value.negated();
}

export function abs(value: Decimal): Decimal {
  return value.abs();
}

export function eq(a: Decimal, b: Decimal): boolean {
  return a.equals(b);
}
export function lt(a: Decimal, b: Decimal): boolean {
  return a.lessThan(b);
}
export function lte(a: Decimal, b: Decimal): boolean {
  return a.lessThanOrEqualTo(b);
}
export function gt(a: Decimal, b: Decimal): boolean {
  return a.greaterThan(b);
}
export function gte(a: Decimal, b: Decimal): boolean {
  return a.greaterThanOrEqualTo(b);
}
export function isZero(a: Decimal): boolean {
  return a.isZero();
}
export function isNegative(a: Decimal): boolean {
  return a.isNegative() && !a.isZero();
}
export function maxOf(a: Decimal, b: Decimal): Decimal {
  return a.greaterThan(b) ? a : b;
}
export function minOf(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

export type Weighted = { id: string; share: Decimal | string };
export type SplitPart = { id: string; amount: Decimal };

export function splitByShares(amount: Decimal, shares: readonly Weighted[]): SplitPart[] {
  if (shares.length === 0) return [];
  const weights = shares.map((s) => ({ id: s.id, weight: decimal(s.share) }));
  const total = sum(weights.map((w) => w.weight));
  const exact = weights.map((w) => ({
    id: w.id,
    value: total.isZero() ? ZERO : amount.times(w.weight).dividedBy(total),
  }));
  const floors = exact.map((e) => ({
    id: e.id,
    amount: e.value.toDecimalPlaces(2, Decimal.ROUND_DOWN),
    remainder: e.value.minus(e.value.toDecimalPlaces(2, Decimal.ROUND_DOWN)),
  }));
  const residual = roundCent(amount).minus(sum(floors.map((f) => f.amount)));
  const steps = Number(residual.dividedBy(CENT).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
  const step = steps >= 0 ? CENT : CENT.negated();
  const order = [...floors].sort((a, b) => {
    const byRemainder =
      steps >= 0 ? b.remainder.comparedTo(a.remainder) : a.remainder.comparedTo(b.remainder);
    return byRemainder !== 0 ? byRemainder : a.id.localeCompare(b.id);
  });
  const bump = new Map<string, Decimal>();
  for (let i = 0; i < Math.abs(steps); i += 1) {
    const target = order[i % order.length];
    if (target === undefined) break;
    bump.set(target.id, (bump.get(target.id) ?? ZERO).plus(step));
  }
  return floors.map((f) => ({ id: f.id, amount: f.amount.plus(bump.get(f.id) ?? ZERO) }));
}

export function splitEqually(amount: Decimal, ids: readonly string[]): SplitPart[] {
  return splitByShares(
    amount,
    ids.map((id) => ({ id, share: "1" })),
  );
}
