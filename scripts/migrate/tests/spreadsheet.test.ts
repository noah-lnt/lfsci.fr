import { describe, expect, it } from "vitest";
import { SourceUnreachable } from "../src/model";
import { createPlatformSource, createSpreadsheetSource } from "../src/sources/spreadsheet";
import { fixture } from "./helpers";

describe("spreadsheet source", () => {
  it("maps the leases by header name and rejects each bad row with its reason", async () => {
    const read = await createSpreadsheetSource([
      { kind: "leases", path: fixture("leases.csv") },
    ]).read();
    expect(read.found).toBe(7);
    expect(read.records.map((r) => r.ref)).toEqual([
      "BAIL-2024-001",
      "BAIL-2022-007",
      "BAIL-2025-004",
      "BAIL-2025-006",
    ]);
    expect(read.rejections.map((r) => [r.line, r.reason])).toEqual([
      [4, "invalid_date"],
      [6, "invalid_money"],
      [8, "duplicate_reference"],
    ]);
    const first = read.records[0];
    expect(first).toMatchObject({
      kind: "lease",
      entity: "SCI Exemple",
      leaseKind: "bare",
      startsOn: "2024-03-01",
      rent: "700.00",
      charges: "80.00",
      deposit: "700.00",
      paymentDay: 5,
    });
    expect(read.records[1]).toMatchObject({ leaseKind: "furnished", endsOn: "2023-09-14" });
  });

  it("rejects a meter with an unknown fluid or half a reading", async () => {
    const read = await createSpreadsheetSource([
      { kind: "meters", path: fixture("meters.csv") },
    ]).read();
    expect(read.records.map((r) => r.ref)).toEqual(["ELEC-0001", "EAU-0001", "GAZ-0001"]);
    expect(read.records[0]).toMatchObject({
      fluid: "electricity",
      lastIndex: "12345.6",
      lastReadOn: "2026-06-30",
      unitOfMeasure: "kWh",
    });
    expect(read.rejections).toEqual([
      expect.objectContaining({
        line: 5,
        reason: "invalid_value",
        detail: "Fluide inconnu : « plasma »",
      }),
    ]);
  });

  it("rejects a loan without its principal and keeps the dated outstanding capital", async () => {
    const read = await createSpreadsheetSource([
      { kind: "loans", path: fixture("loans.csv") },
    ]).read();
    expect(read.records[0]).toMatchObject({
      principal: "180000.00",
      nominalRate: "1.25",
      outstanding: "121430.55",
      outstandingOn: "2025-12-31",
    });
    expect(read.rejections).toEqual([
      expect.objectContaining({
        line: 4,
        reason: "missing_field",
        detail: "Capital emprunté manquant",
      }),
    ]);
  });

  it("reads the platform export and rejects a stay that ends on its first day", async () => {
    const read = await createPlatformSource(fixture("bookings.csv")).read();
    expect(read.source).toBe("platform");
    expect(read.records).toHaveLength(1);
    expect(read.rejections[0]).toMatchObject({ reason: "invalid_date" });
  });

  it("cannot look when a file is missing or a required column is absent", async () => {
    await expect(
      createSpreadsheetSource([{ kind: "leases", path: fixture("absent.csv") }]).read(),
    ).rejects.toBeInstanceOf(SourceUnreachable);
    await expect(
      createSpreadsheetSource([{ kind: "leases", path: fixture("tenants.csv") }]).read(),
    ).rejects.toThrow(/colonnes obligatoires absentes/);
  });
});
