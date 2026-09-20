import type { LeaseStatus } from "@lfsci/contracts";
import type { tables } from "@lfsci/db";
import { money, receiptKind, toMoney, ZERO } from "@lfsci/domain";
import type { MissingPiece, ReceiptKind, Settlement } from "@/lib/contracts/locations";

export type LeaseRow = typeof tables.lease.$inferSelect;
export type RentTermRow = typeof tables.rentTerm.$inferSelect;
export type RentTermVersionRow = typeof tables.rentTermVersion.$inferSelect;

/** Spec §13.3: the lease lifecycle, plus the branches leaving it before activation. */
export const LEASE_TRANSITIONS: Record<LeaseStatus, LeaseStatus[]> = {
  draft: ["ready_to_sign", "cancelled"],
  ready_to_sign: ["signed", "draft", "cancelled"],
  signed: ["active", "cancelled"],
  active: ["terminated", "disputed"],
  terminated: ["archived", "disputed"],
  disputed: ["active", "terminated"],
  cancelled: ["archived"],
  archived: [],
};

export function allowedTransitions(status: LeaseStatus): LeaseStatus[] {
  return LEASE_TRANSITIONS[status];
}

/** BAI-01: the pieces the engine checks before a lease may be activated. */
export function missingPieces(input: {
  lease: Pick<LeaseRow, "startsOn" | "rentExclCharges" | "depositAmount" | "paymentDay">;
  parties: readonly { role: string }[];
  units: readonly { role: string }[];
}): MissingPiece[] {
  const missing: MissingPiece[] = [];
  if (!input.parties.some((party) => party.role === "holder" || party.role === "co_holder")) {
    missing.push("party");
  }
  if (!input.units.some((unit) => unit.role === "main")) missing.push("unit");
  if (!input.lease.startsOn || input.lease.paymentDay === null) missing.push("dates");
  if (input.lease.rentExclCharges === null) missing.push("rent");
  if (input.lease.depositAmount === null) missing.push("deposit");
  return missing;
}

/**
 * One imputation rule, used both when allocating and when reading a balance:
 * money goes to the rent first, then to the charges.
 */
export function splitOnRentFirst(
  amount: string,
  rent: string,
  charges: string,
): { rent: string; charges: string } {
  const total = money(amount);
  const toRent = total.greaterThan(money(rent)) ? money(rent) : total;
  const rest = total.minus(toRent);
  const toCharges = rest.greaterThan(money(charges)) ? money(charges) : rest;
  return { rent: toMoney(toRent), charges: toMoney(toCharges) };
}

export function settlementOf(paid: string, total: string): Settlement {
  const value = money(paid);
  if (value.greaterThanOrEqualTo(money(total))) return "paid";
  return value.isZero() ? "unpaid" : "partial";
}

export function receiptKindOf(term: {
  rentAmount: string;
  chargeAmount: string;
  paidAmount: string;
}): ReceiptKind {
  const paid = splitOnRentFirst(term.paidAmount, term.rentAmount, term.chargeAmount);
  return receiptKind({
    rent: term.rentAmount,
    charges: term.chargeAmount,
    paidRent: paid.rent,
    paidCharges: paid.charges,
  });
}

export function outstandingOf(total: string, paid: string): string {
  const rest = money(total).minus(money(paid));
  return toMoney(rest.isNegative() ? ZERO : rest);
}

export function sumMoney(values: readonly string[]): string {
  return toMoney(values.reduce((acc, value) => acc.plus(money(value)), ZERO));
}

/** PAT-01: a lease kind implies the unit usage recorded when it becomes active. */
export function usageForLeaseKind(kind: string): string {
  switch (kind) {
    case "furnished":
      return "furnished_rental";
    case "mobility":
      return "mobility_rental";
    case "tourist":
      return "tourist_rental";
    case "commercial":
    case "professional":
      return "commercial_rental";
    default:
      return "bare_rental";
  }
}

/** Postgres renders timestamptz as "2026-09-20 06:30:00+00"; the contract wants ISO-8601. */
export function instant(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  // "2026-09-20 06:30:00.12+00": a space instead of T, and an hour-only offset
  // that V8 refuses.
  const parsed = new Date(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const raw = new Date(value);
  return Number.isNaN(raw.getTime()) ? value : raw.toISOString();
}

export function encodeCursor(sortKey: string, id: string): string {
  return Buffer.from(`${sortKey}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): { sortKey: string; id: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) return null;
  return { sortKey: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}

/** The next term a tenant owes: the earliest unsettled due date. */
export function nextDueOn(terms: readonly { dueOn: string; outstanding: string }[]): string | null {
  const open = terms
    .filter((term) => !money(term.outstanding).isZero())
    .map((term) => term.dueOn)
    .sort();
  return open[0] ?? null;
}
