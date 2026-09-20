import type { Building, LegalEntity, ObjectRef, Unit, UnitUsagePeriod } from "@lfsci/contracts";
import { type ObjectKind, objectRefColumnByKind, type tables } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";

/**
 * postgres.js hands timestamptz back as `2026-09-20 06:30:00.123+00`; the
 * contract declares ISO-8601 with an offset. Every mapper goes through here.
 */
export function instant(value: string): string {
  // `2026-09-20 06:30:00.123+00` needs both a `T` and a two-part offset before
  // `Date` will read it; a bare `+00` parses as NaN.
  const normalised = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = new Date(normalised);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("INTERNAL", { message: `unreadable timestamp: ${value}` });
  }
  return parsed.toISOString();
}

export function instantOrNull(value: string | null): string | null {
  return value === null ? null : instant(value);
}

export type Cursor = { at: string; id: string };

/** Keyset pagination on `(sort column, id)`, both carried so ties are stable. */
export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): Cursor {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf("|");
  const at = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (separator <= 0 || at.length === 0 || id.length === 0) {
    throw new AppError("VALIDATION", { message: "curseur illisible" });
  }
  return { at, id };
}

/** Takes `limit + 1` rows and splits them into a page and its next cursor. */
export function page<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? cursorOf(last) : null,
  };
}

/** Unknown id and foreign id must be indistinguishable (tech pack §10: 404, never 403). */
export function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new AppError("NOT_FOUND", { details: { object: label } });
  return row;
}

export function assertVersion(matched: boolean, exists: boolean, label: string): void {
  if (matched) return;
  if (!exists) throw new AppError("NOT_FOUND", { details: { object: label } });
  throw new AppError("VERSION_CONFLICT", { details: { object: label } });
}

type ObjectRefRow = Record<string, unknown> & { kind: string };

/** Reads the one populated id column of an `object_ref` row back into `{kind, id}`. */
export function objectRefFromRow(row: ObjectRefRow): ObjectRef {
  const kind = row.kind as ObjectKind;
  const column = objectRefColumnByKind[kind];
  const id = column ? row[column] : undefined;
  if (typeof id !== "string") {
    throw new AppError("INTERNAL", { message: `object_ref row has no id for kind ${row.kind}` });
  }
  return { kind, id };
}

type LegalEntityRow = typeof tables.legalEntity.$inferSelect;
type BuildingRow = typeof tables.building.$inferSelect;
type UnitRow = typeof tables.unit.$inferSelect;
type UsagePeriodRow = typeof tables.unitUsagePeriod.$inferSelect;

export function toLegalEntity(row: LegalEntityRow): LegalEntity {
  return {
    id: row.id,
    createdAt: instant(row.createdAt),
    updatedAt: instantOrNull(row.updatedAt),
    version: row.version,
    name: row.name,
    legalForm: row.legalForm as LegalEntity["legalForm"],
    siren: row.siren,
    incomeTaxRegime: row.incomeTaxRegime as LegalEntity["incomeTaxRegime"],
    vatStatus: row.vatStatus as LegalEntity["vatStatus"],
    fiscalQualificationValidatedOn: row.fiscalQualificationValidatedOn,
    eInvoicingChannel: row.eInvoicingChannel as LegalEntity["eInvoicingChannel"],
    fiscalYearEndMonth: row.fiscalYearEndMonth,
    fiscalYearEndDay: row.fiscalYearEndDay,
    odooCompanyId: row.odooCompanyId,
    currency: row.currency,
    status: row.status as LegalEntity["status"],
  };
}

export function toBuilding(row: BuildingRow): Building {
  return {
    id: row.id,
    createdAt: instant(row.createdAt),
    updatedAt: instantOrNull(row.updatedAt),
    version: row.version,
    legalEntityId: row.legalEntityId,
    code: row.code,
    name: row.name,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    postalCode: row.postalCode,
    city: row.city,
    countryCode: row.countryCode,
    cadastralRef: row.cadastralRef,
    acquiredOn: row.acquiredOn,
    soldOn: row.soldOn,
    status: row.status as Building["status"],
  };
}

export function toUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    createdAt: instant(row.createdAt),
    updatedAt: instantOrNull(row.updatedAt),
    version: row.version,
    buildingId: row.buildingId,
    code: row.code,
    label: row.label,
    kind: row.kind as Unit["kind"],
    floor: row.floor,
    roomCount: row.roomCount,
    livingAreaSqm: row.livingAreaSqm,
    ownershipShare: row.ownershipShare,
    energyClass: row.energyClass as Unit["energyClass"],
    energyAuditOn: row.energyAuditOn,
    energyClassValidUntil: row.energyClassValidUntil,
    acquiredOn: row.acquiredOn,
    disposedOn: row.disposedOn,
    status: row.status as Unit["status"],
  };
}

export function toUsagePeriod(row: UsagePeriodRow): UnitUsagePeriod {
  return {
    id: row.id,
    createdAt: instant(row.createdAt),
    updatedAt: instantOrNull(row.updatedAt),
    version: row.version,
    unitId: row.unitId,
    usage: row.usage as UnitUsagePeriod["usage"],
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    note: row.note,
  };
}
