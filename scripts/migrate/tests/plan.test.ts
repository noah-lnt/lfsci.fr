import { describe, expect, it } from "vitest";
import { runDryRun } from "../src/dry-run";
import type { SourceReader } from "../src/model";
import { SourceUnreachable } from "../src/model";
import { buildPlan } from "../src/plan";
import { renderPlan } from "../src/report";
import { createOdooSource } from "../src/sources/odoo";
import { createSpreadsheetSource } from "../src/sources/spreadsheet";
import {
  ENTITY_ID,
  EXISTING_PERSON_ID,
  existingRows,
  fakeOdoo,
  fixture,
  seedLedger,
} from "./helpers";

async function reads() {
  const { server, client } = fakeOdoo();
  seedLedger(server);
  const odoo = await createOdooSource({ client }).read();
  const sheets = await createSpreadsheetSource([
    { kind: "tenants", path: fixture("tenants.csv") },
    { kind: "leases", path: fixture("leases.csv") },
    { kind: "meters", path: fixture("meters.csv") },
    { kind: "loans", path: fixture("loans.csv") },
  ]).read();
  return [odoo, sheets];
}

describe("plan", () => {
  it("links Odoo history to the leases through the tenant, defers the unpaid term and rejects what it cannot place", async () => {
    const plan = buildPlan({
      organizationId: "org",
      reads: await reads(),
      existing: existingRows(),
    });

    expect(plan.resolutions.rentTermLeases["account.move:55"]).toEqual({
      create: "lease:BAIL-2024-001",
    });
    expect(plan.deferrals).toEqual([
      expect.objectContaining({ kind: "bank_line", reason: "owned_by_backsync" }),
    ]);
    expect(
      plan.rejections.filter((r) => r.source === "odoo").map((r) => [r.ref, r.reason]),
    ).toEqual([
      ["account.move:60", "not_posted"],
      ["account.move:71", "missing_field"],
      ["account.move:61", "unknown_lease"],
    ]);
    expect(plan.rejections.filter((r) => r.reason === "unknown_entity")).toEqual([
      expect.objectContaining({ ref: "BAIL-2025-004" }),
    ]);
    expect(plan.rejections.filter((r) => r.reason === "unknown_person")).toEqual([
      expect.objectContaining({
        ref: "BAIL-2025-006",
        detail: expect.stringContaining("Marie Inconnue"),
      }),
    ]);
    expect(plan.rejections.filter((r) => r.reason === "unknown_building")).toEqual([
      expect.objectContaining({ ref: "GAZ-0001" }),
    ]);
    expect(plan.matches).toContainEqual(
      expect.objectContaining({
        kind: "legal_entity",
        evidence: "odoo_company_id",
        existingId: ENTITY_ID,
      }),
    );
    expect(plan.resolutions.persons["res.partner:13"]).toEqual(plan.resolutions.persons["T-001"]);
    expect(plan.perEntity).toEqual([
      expect.objectContaining({
        entityName: "SCI Exemple",
        counts: { rent_term: 2, expense: 1, lease: 2, meter: 2, loan: 2 },
        totals: { rent_term: "1560.00", expense: "312.50", lease: "1250.00", loan: "275000.00" },
      }),
    ]);
    expect(plan.blockers).toEqual([]);
    expect(renderPlan(plan)).toContain("Aucun bloqueur");
  });

  it("proposes the existing person on an accent-insensitive name and never applies it", async () => {
    const plan = buildPlan({
      organizationId: "org",
      reads: await reads(),
      existing: existingRows({
        persons: [
          { id: EXISTING_PERSON_ID, displayName: "élodie DURAND", odooPartnerId: null, emails: [] },
        ],
      }),
    });
    expect(plan.matches).toContainEqual(
      expect.objectContaining({
        kind: "person",
        label: "Élodie Durand",
        existingId: EXISTING_PERSON_ID,
        evidence: "name",
        confidence: "medium",
      }),
    );
    expect(plan.resolutions.persons["T-002"]).toEqual({ existingId: EXISTING_PERSON_ID });
    expect(Object.keys(plan.resolutions.personGroups)).not.toContain("person:durand elodie");
  });

  it("blocks on an ambiguity and on a source that read nothing", async () => {
    const [odoo, sheets] = await reads();
    if (!odoo || !sheets) throw new Error("fixture reads");
    const plan = buildPlan({
      organizationId: "org",
      reads: [
        odoo,
        sheets,
        {
          ...sheets,
          source: "platform",
          label: "export vide",
          found: 0,
          records: [],
          rejections: [],
        },
      ],
      existing: existingRows({
        leases: [
          {
            id: "l1",
            reference: "OLD-1",
            legalEntityId: ENTITY_ID,
            holderPersonIds: [EXISTING_PERSON_ID],
          },
          {
            id: "l2",
            reference: "OLD-2",
            legalEntityId: ENTITY_ID,
            holderPersonIds: [EXISTING_PERSON_ID],
          },
        ],
        persons: [
          { id: EXISTING_PERSON_ID, displayName: "Jean Dupont", odooPartnerId: 15, emails: [] },
        ],
      }),
    });
    expect(plan.ambiguities).toEqual([
      expect.objectContaining({
        kind: "lease",
        ref: "account.move:61",
        evidence: "tenant",
        candidates: [
          { id: "l1", label: "bail existant l1" },
          { id: "l2", label: "bail existant l2" },
        ],
      }),
    ]);
    expect(plan.resolutions.rentTermLeases["account.move:61"]).toBeUndefined();
    expect(plan.blockers).toEqual([
      expect.stringContaining("export vide : aucun enregistrement lu"),
      "1 correspondance(s) ambiguë(s) à trancher par le propriétaire",
    ]);
  });
});

describe("dry run", () => {
  it("fails, and says which source, when one cannot be read", async () => {
    const dead: SourceReader = {
      name: "odoo",
      read: async () => {
        throw new SourceUnreachable(
          "odoo",
          "Odoo res.partner: UPSTREAM_UNAVAILABLE — fetch failed",
        );
      },
    };
    const result = await runDryRun({
      organizationId: "org",
      readers: [dead, createSpreadsheetSource([{ kind: "tenants", path: fixture("tenants.csv") }])],
      existing: async () => existingRows(),
    });
    expect(result).toEqual({
      ok: false,
      failures: [
        { source: "odoo", message: "Odoo res.partner: UPSTREAM_UNAVAILABLE — fetch failed" },
      ],
    });
  });

  it("fails when the application database cannot be read", async () => {
    const result = await runDryRun({
      organizationId: "org",
      readers: [createSpreadsheetSource([{ kind: "tenants", path: fixture("tenants.csv") }])],
      existing: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:5434");
      },
    });
    expect(result).toMatchObject({ ok: false, failures: [{ source: "database" }] });
  });
});
