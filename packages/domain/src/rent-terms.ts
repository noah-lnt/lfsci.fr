import type { Decimal } from "decimal.js";
import { money, roundCent, toMoney, ZERO } from "./money";
import {
  type DateRange,
  daysBetween,
  daysInMonthOf,
  type IsoDateString,
  maxIsoDate,
  minIsoDate,
  monthlyPeriods,
  overlapRange,
  previousDay,
} from "./periods";

export type ChargeKind = "provision" | "flat";
export type TermKind = "rent";

export type RentVersion = {
  effectiveFrom: IsoDateString;
  rentExclCharges: string;
  charges: { kind: ChargeKind; amount: string };
};

export type LeaseTerms = {
  leaseId: string;
  start: IsoDateString;
  end?: IsoDateString | undefined;
  dueDay: number;
  versions: readonly RentVersion[];
};

export type RentTerm = {
  leaseId: string;
  kind: TermKind;
  periodStart: IsoDateString;
  periodEnd: IsoDateString;
  dueDate: IsoDateString;
  days: number;
  daysInMonth: number;
  prorated: boolean;
  chargeKind: ChargeKind;
  rent: string;
  charges: string;
  total: string;
  version: number;
};

function sortedVersions(versions: readonly RentVersion[]): RentVersion[] {
  return [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

function dueDateFor(periodStart: IsoDateString, dueDay: number): IsoDateString {
  const inMonth = daysInMonthOf(periodStart);
  const day = Math.min(Math.max(dueDay, 1), inMonth);
  const candidate = `${periodStart.slice(0, 7)}-${String(day).padStart(2, "0")}`;
  return maxIsoDate(candidate, periodStart);
}

export function generateRentTerms(lease: LeaseTerms, window: DateRange): RentTerm[] {
  const versions = sortedVersions(lease.versions);
  if (versions.length === 0) return [];
  const leaseEnd = lease.end ?? window.end;
  if (leaseEnd < lease.start) return [];

  const terms: RentTerm[] = [];
  for (const period of monthlyPeriods({ start: lease.start, end: leaseEnd })) {
    if (overlapRange(period, window) === null) continue;
    const daysInMonth = daysInMonthOf(period.start);
    let rent = ZERO;
    let charges = ZERO;
    let version = 0;
    let chargeKind: ChargeKind = "provision";

    for (const [index, current] of versions.entries()) {
      const next = versions[index + 1];
      const span: DateRange = {
        start: current.effectiveFrom,
        end:
          next === undefined ? period.end : minIsoDate(period.end, previousDay(next.effectiveFrom)),
      };
      const slice = overlapRange(period, span);
      if (slice === null) continue;
      const days = daysBetween(slice.start, slice.end);
      rent = rent.plus(share(money(current.rentExclCharges), days, daysInMonth));
      charges = charges.plus(share(money(current.charges.amount), days, daysInMonth));
      version = index + 1;
      chargeKind = current.charges.kind;
    }
    if (version === 0) continue;

    const roundedRent = roundCent(rent);
    const roundedCharges = roundCent(charges);
    terms.push({
      leaseId: lease.leaseId,
      kind: "rent",
      periodStart: period.start,
      periodEnd: period.end,
      dueDate: dueDateFor(period.start, lease.dueDay),
      days: period.days,
      daysInMonth,
      prorated: period.partial,
      chargeKind,
      rent: toMoney(roundedRent),
      charges: toMoney(roundedCharges),
      total: toMoney(roundedRent.plus(roundedCharges)),
      version,
    });
  }
  return terms;
}

export function termIdentity(term: Pick<RentTerm, "leaseId" | "kind" | "periodStart">): string {
  return `${term.leaseId}:${term.kind}:${term.periodStart}`;
}

function share(monthly: Decimal, days: number, daysInMonth: number): Decimal {
  if (days === daysInMonth) return monthly;
  return monthly.times(days).dividedBy(daysInMonth);
}
