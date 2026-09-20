import { isAppError } from "@lfsci/kernel";
import { describe, expect, it } from "vitest";
import {
  assertVersion,
  decodeCursor,
  encodeCursor,
  instant,
  instantOrNull,
  objectRefFromRow,
  page,
  requireRow,
  toBuilding,
  toLegalEntity,
  toUnit,
  toUsagePeriod,
} from "./rows";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return isAppError(error) ? error.code : "NOT_AN_APP_ERROR";
  }
  return "NO_ERROR";
}

const audited = {
  id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  organizationId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
  createdAt: "2026-09-20 06:30:00.123+00",
  updatedAt: null,
  version: 1,
};

describe("instant", () => {
  it("turns the postgres rendering into ISO-8601 with an offset", () => {
    expect(instant("2026-09-20 06:30:00.123+00")).toBe("2026-09-20T06:30:00.123Z");
    expect(instant("2026-09-20T06:30:00.123Z")).toBe("2026-09-20T06:30:00.123Z");
    expect(instant("2026-09-20 08:30:00+02")).toBe("2026-09-20T06:30:00.000Z");
  });

  it("keeps null as null and refuses an unreadable value", () => {
    expect(instantOrNull(null)).toBeNull();
    expect(instantOrNull("2026-09-20 06:30:00+00")).toBe("2026-09-20T06:30:00.000Z");
    expect(codeOf(() => instant("pas une date"))).toBe("INTERNAL");
  });
});

describe("cursors", () => {
  it("round-trips a timestamp carrying the separator", () => {
    const at = "2026-09-20 06:30:00.123+00";
    expect(decodeCursor(encodeCursor(at, audited.id))).toEqual({ at, id: audited.id });
  });

  it("refuses a malformed cursor", () => {
    for (const bad of ["", "Zm9v", encodeCursor("", "x")]) {
      expect(codeOf(() => decodeCursor(bad))).toBe("VALIDATION");
    }
  });

  it("returns a next cursor only when a further row was read", () => {
    const rows = [
      { createdAt: "2026-09-20 06:30:00+00", id: "a" },
      { createdAt: "2026-09-19 06:30:00+00", id: "b" },
      { createdAt: "2026-09-18 06:30:00+00", id: "c" },
    ];
    const cursorOf = (row: { createdAt: string; id: string }) =>
      encodeCursor(row.createdAt, row.id);

    const full = page(rows, 2, cursorOf);
    expect(full.items).toHaveLength(2);
    expect(full.nextCursor).toBe(cursorOf(rows[1] as (typeof rows)[number]));

    expect(page(rows, 3, cursorOf).nextCursor).toBeNull();
    expect(page([], 3, cursorOf)).toEqual({ items: [], nextCursor: null });
  });
});

describe("guards", () => {
  it("renders an unknown row as NOT_FOUND", () => {
    expect(codeOf(() => requireRow(undefined, "unit"))).toBe("NOT_FOUND");
    expect(requireRow({ id: "x" }, "unit")).toEqual({ id: "x" });
  });

  it("separates a stale version from a missing row", () => {
    expect(codeOf(() => assertVersion(false, true, "unit"))).toBe("VERSION_CONFLICT");
    expect(codeOf(() => assertVersion(false, false, "unit"))).toBe("NOT_FOUND");
    expect(codeOf(() => assertVersion(true, true, "unit"))).toBe("NO_ERROR");
  });
});

describe("objectRefFromRow", () => {
  it("reads the one populated id column back", () => {
    expect(objectRefFromRow({ kind: "unit", unitId: audited.id, buildingId: null })).toEqual({
      kind: "unit",
      id: audited.id,
    });
  });

  it("refuses a row whose kind column is empty", () => {
    expect(codeOf(() => objectRefFromRow({ kind: "unit", unitId: null }))).toBe("INTERNAL");
    expect(codeOf(() => objectRefFromRow({ kind: "nope" }))).toBe("INTERNAL");
  });
});

describe("row mappers", () => {
  it("maps a legal entity, dropping the tenant column", () => {
    const entity = toLegalEntity({
      ...audited,
      name: "SCI d’essai",
      legalForm: "sci",
      siren: null,
      incomeTaxRegime: "to_qualify",
      vatStatus: "to_qualify",
      fiscalQualificationValidatedOn: null,
      fiscalQualificationValidatedBy: null,
      eInvoicingChannel: null,
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      odooCompanyId: null,
      currency: "EUR",
      addressLine1: "2 rue Henri Farman",
      addressLine2: null,
      postalCode: "64230",
      city: "Lescar",
      country: "FR",
      contactEmail: null,
      contactPhone: null,
      status: "active",
    });
    expect(entity.createdAt).toBe("2026-09-20T06:30:00.123Z");
    expect(entity).not.toHaveProperty("organizationId");
    expect(entity.fiscalYearEndMonth).toBe(12);
    expect(entity.postalCode).toBe("64230");
  });

  it("keeps dates as YYYY-MM-DD and numerics as strings", () => {
    const building = toBuilding({
      ...audited,
      legalEntityId: audited.organizationId,
      code: "A1",
      name: "Résidence",
      addressLine1: "1 rue des Lilas",
      addressLine2: null,
      postalCode: "64000",
      city: "Pau",
      countryCode: "FR",
      cadastralRef: null,
      acquiredOn: "2020-03-10",
      soldOn: null,
      status: "active",
    });
    expect(building.acquiredOn).toBe("2020-03-10");

    const unit = toUnit({
      ...audited,
      buildingId: audited.organizationId,
      code: "L1",
      label: "T2",
      kind: "dwelling",
      floor: "1",
      roomCount: 2,
      livingAreaSqm: "34.50",
      ownershipShare: "0.500000",
      energyClass: "D",
      energyAuditOn: "2024-01-05",
      energyClassValidUntil: null,
      acquiredOn: null,
      disposedOn: null,
      status: "active",
    });
    expect(unit.livingAreaSqm).toBe("34.50");
    expect(unit.ownershipShare).toBe("0.500000");

    const period = toUsagePeriod({
      ...audited,
      unitId: audited.organizationId,
      usage: "furnished_rental",
      startsOn: "2026-01-01",
      endsOn: null,
      note: null,
    });
    expect(period).toMatchObject({
      usage: "furnished_rental",
      startsOn: "2026-01-01",
      endsOn: null,
    });
  });
});
