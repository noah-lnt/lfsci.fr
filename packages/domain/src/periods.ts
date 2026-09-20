import { addDays, addMonths, differenceInCalendarDays, getDaysInMonth } from "date-fns";
import { Decimal } from "decimal.js";
import { ZERO } from "./money";

export type IsoDateString = string;

export type MonthPeriod = {
  start: IsoDateString;
  end: IsoDateString;
  days: number;
  daysInMonth: number;
  partial: boolean;
};

export type DateRange = { start: IsoDateString; end: IsoDateString };

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Calendar dates carry no instant: anchoring at local noon keeps a DST shift from
// moving the day, whatever the runtime timezone.
export function parseIsoDate(value: IsoDateString): Date {
  if (!ISO_PATTERN.test(value)) throw new TypeError(`invalid ISO date: ${value}`);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new TypeError(`invalid ISO date: ${value}`);
  }
  return date;
}

export function formatIsoDate(date: Date): IsoDateString {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysInMonthOf(value: IsoDateString): number {
  return getDaysInMonth(parseIsoDate(value));
}

export function monthStartOf(value: IsoDateString): IsoDateString {
  return `${value.slice(0, 7)}-01`;
}

export function monthEndOf(value: IsoDateString): IsoDateString {
  return `${value.slice(0, 7)}-${String(daysInMonthOf(value)).padStart(2, "0")}`;
}

export function addDaysIso(value: IsoDateString, days: number): IsoDateString {
  return formatIsoDate(addDays(parseIsoDate(value), days));
}

export function previousDay(value: IsoDateString): IsoDateString {
  return addDaysIso(value, -1);
}

export function addMonthsIso(value: IsoDateString, months: number): IsoDateString {
  return formatIsoDate(addMonths(parseIsoDate(value), months));
}

export function compareIsoDates(a: IsoDateString, b: IsoDateString): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxIsoDate(a: IsoDateString, b: IsoDateString): IsoDateString {
  return a >= b ? a : b;
}

export function minIsoDate(a: IsoDateString, b: IsoDateString): IsoDateString {
  return a <= b ? a : b;
}

// Inclusive day count: daysBetween(d, d) === 1.
export function daysBetween(from: IsoDateString, to: IsoDateString): number {
  const diff = differenceInCalendarDays(parseIsoDate(to), parseIsoDate(from));
  return diff < 0 ? 0 : diff + 1;
}

export function overlapDays(a: DateRange, b: DateRange): number {
  const start = maxIsoDate(a.start, b.start);
  const end = minIsoDate(a.end, b.end);
  return daysBetween(start, end);
}

export function overlapRange(a: DateRange, b: DateRange): DateRange | null {
  const start = maxIsoDate(a.start, b.start);
  const end = minIsoDate(a.end, b.end);
  return start > end ? null : { start, end };
}

export function monthlyPeriods(input: {
  start: IsoDateString;
  end?: IsoDateString | undefined;
  count?: number | undefined;
}): MonthPeriod[] {
  const last =
    input.end ??
    (input.count !== undefined && input.count > 0
      ? monthEndOf(addMonthsIso(monthStartOf(input.start), input.count - 1))
      : undefined);
  if (last === undefined) {
    throw new TypeError("monthlyPeriods needs an end date or a positive count");
  }
  const periods: MonthPeriod[] = [];
  let cursor = input.start;
  while (cursor <= last) {
    const end = minIsoDate(monthEndOf(cursor), last);
    const daysInMonth = daysInMonthOf(cursor);
    const days = daysBetween(cursor, end);
    periods.push({ start: cursor, end, days, daysInMonth, partial: days !== daysInMonth });
    cursor = monthStartOf(addMonthsIso(monthStartOf(cursor), 1));
  }
  return periods;
}

export function prorataFactor(period: { days: number; daysInMonth: number }): Decimal {
  if (period.daysInMonth === 0) return ZERO;
  return new Decimal(period.days).dividedBy(period.daysInMonth);
}
