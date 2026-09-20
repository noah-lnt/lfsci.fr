import "server-only";
import { decimal, toMoney, ZERO } from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";

/** Postgres renders timestamptz as "2026-09-20 06:30:00+00"; the contract wants ISO-8601. */
export function instant(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function instantOrNow(value: string | null | undefined): string {
  return instant(value) ?? new Date().toISOString();
}

/** A numeric read back from Postgres, normalised to a two-decimal money string. */
export function amount(value: string | number | null | undefined, fallback = "0.00"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return toMoney(decimal(String(value)));
}

export function amountOrNull(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return toMoney(decimal(String(value)));
}

export function sumAmounts(values: readonly (string | number | null | undefined)[]): string {
  return toMoney(
    values.reduce(
      (acc, value) =>
        value === null || value === undefined || value === ""
          ? acc
          : acc.plus(decimal(String(value))),
      ZERO,
    ),
  );
}

export function today(): string {
  const parts = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
  return parts;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const DEFAULT_LIMIT = 50;

/** Offset cursor: at this scale a keyset cursor buys nothing and costs clarity. */
export function offsetFromCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError("VALIDATION", { message: "Curseur de pagination invalide." });
  }
  return parsed;
}

export function nextCursor(offset: number, limit: number, received: number): string | null {
  return received > limit ? String(offset + limit) : null;
}

export function notFound(what: string): never {
  throw new AppError("NOT_FOUND", { message: `${what} introuvable.` });
}

export function versionConflict(what: string): never {
  throw new AppError("VERSION_CONFLICT", {
    message: `${what} a été modifié entre-temps ; rechargez la page.`,
  });
}

export function ruleViolation(message: string, details?: Record<string, unknown>): never {
  throw new AppError("RULE_VIOLATION", { message, ...(details ? { details } : {}) });
}

export function firstOr<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (!row) notFound(what);
  return row;
}
