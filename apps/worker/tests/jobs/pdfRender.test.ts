import { buildDecompteData, buildRevisionData } from "@lfsci/pdf";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../../src/deps";
import { decompteSource, PdfRenderData, revisionSource } from "../../src/jobs/pdfRender";
import {
  adminDb,
  appDb,
  closeDbs,
  ENTITY_ID,
  migrate,
  ORG_ID,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "../db";
import { fakeDeps } from "../fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const REQUEST_ID = "0199a000-0000-7000-8000-000000000004";
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000001";
const BUILDING_ID = "40000000-0000-4000-8000-000000000002";
const UNIT_ID = "40000000-0000-4000-8000-000000000003";
const PERSON_ID = "40000000-0000-4000-8000-000000000004";
const LEASE_ID = "40000000-0000-4000-8000-000000000005";
const RUN_ID = "40000000-0000-4000-8000-000000000006";
const REVISION_ID = "40000000-0000-4000-8000-000000000007";
const OTHER_LEASE_ID = "40000000-0000-4000-8000-000000000008";

const NOW = new Date("2026-09-20T08:00:00.000Z");

function deps(): Deps {
  return fakeDeps({ db: appDb(), admin: adminDb(), now: () => NOW });
}

async function seedLease(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO building (id, organization_id, legal_entity_id, code, name, address_line1,
                          postal_code, city)
    VALUES (${BUILDING_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'BAT-1', 'Résidence test',
            '1 rue Exemple', '64000', 'Pau')
  `);
  await db.execute(sql`
    INSERT INTO unit (id, organization_id, building_id, code, label, kind)
    VALUES (${UNIT_ID}::uuid, ${ORG_ID}::uuid, ${BUILDING_ID}::uuid, 'LOT-A1', 'Appartement A1', 'dwelling')
  `);
  await db.execute(sql`
    INSERT INTO person (id, organization_id, kind, display_name)
    VALUES (${PERSON_ID}::uuid, ${ORG_ID}::uuid, 'natural', 'Camille Martin')
  `);
  await db.execute(sql`
    INSERT INTO lease (id, organization_id, legal_entity_id, reference, kind, status,
                       starts_on, rent_excl_charges, charge_amount, payment_day)
    VALUES (${LEASE_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'BAIL-001', 'bare', 'active',
            '2025-06-01', 700.00, 80.00, 5)
  `);
  await db.execute(sql`
    INSERT INTO lease_party (organization_id, lease_id, person_id, role, starts_on, is_billing_contact)
    VALUES (${ORG_ID}::uuid, ${LEASE_ID}::uuid, ${PERSON_ID}::uuid, 'holder', '2025-06-01', true)
  `);
  await db.execute(sql`
    INSERT INTO lease_unit (organization_id, lease_id, unit_id, role, starts_on)
    VALUES (${ORG_ID}::uuid, ${LEASE_ID}::uuid, ${UNIT_ID}::uuid, 'main', '2025-06-01')
  `);
  await db.execute(sql`
    INSERT INTO document (id, organization_id, title, nature, status)
    VALUES (${DOCUMENT_ID}::uuid, ${ORG_ID}::uuid, 'Décompte', 'charge_statement', 'uploading')
  `);
}

async function setEntityAddress(): Promise<void> {
  await adminDb().db.execute(sql`
    UPDATE legal_entity
       SET address_line1 = '12 avenue des Pyrénées', address_line2 = 'Bâtiment B',
           postal_code = '64230', city = 'Lescar', siren = '123456789'
     WHERE id = ${ENTITY_ID}::uuid
  `);
}

function frozenPayload() {
  return {
    runId: RUN_ID,
    postings: [
      {
        chargeId: "charge-1",
        label: "Entretien chaudière",
        recoverableAmount: "300.00",
        keyLabel: "Tantièmes chauffage",
        lots: [
          {
            unitId: UNIT_ID,
            amount: "180.00",
            tenants: [{ leaseId: LEASE_ID, days: 365, amount: "180.00" }],
          },
        ],
      },
      {
        chargeId: "charge-2",
        label: "Nettoyage des parties communes",
        recoverableAmount: "120.00",
        keyLabel: null,
        lots: [
          {
            unitId: UNIT_ID,
            amount: "120.00",
            tenants: [
              { leaseId: LEASE_ID, days: 182, amount: "60.00" },
              { leaseId: OTHER_LEASE_ID, days: 183, amount: "60.00" },
            ],
          },
        ],
      },
    ],
    lines: [
      {
        leaseId: LEASE_ID,
        leaseReference: "BAIL-001",
        tenantName: "Camille Martin",
        unitId: UNIT_ID,
        unitLabel: "LOT-A1 — Appartement A1",
        occupancyDays: 365,
        periodDays: 365,
        recoverableAmount: "240.00",
        provisionsCalled: "300.00",
        provisionsPaid: "280.00",
        provisionsUnpaid: "20.00",
        balanceAmount: "-60.00",
        currency: "EUR",
      },
    ],
  };
}

async function seedRun(frozen: boolean): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO provision_regularization_run (id, organization_id, legal_entity_id, building_id,
                                              period_start, period_end, status, frozen_at)
    VALUES (${RUN_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, ${BUILDING_ID}::uuid,
            '2026-01-01', '2026-12-31', ${frozen ? "frozen" : "computed"},
            ${frozen ? "2026-09-19T10:00:00Z" : null}::timestamptz)
  `);
  if (!frozen) return;
  const refs = await db.execute<{ id: string }>(sql`
    INSERT INTO object_ref (organization_id, kind, legal_entity_id)
    VALUES (${ORG_ID}::uuid, 'legal_entity', ${ENTITY_ID}::uuid)
    RETURNING id
  `);
  await db.execute(sql`
    INSERT INTO event (organization_id, type, primary_object_ref_id, occurred_at, origin, payload)
    VALUES (${ORG_ID}::uuid, 'regularization.frozen', ${[...refs][0]?.id}::uuid,
            '2026-09-19T10:00:00Z'::timestamptz, 'user', ${JSON.stringify(frozenPayload())}::jsonb)
  `);
}

async function seedRevision(): Promise<void> {
  await adminDb().db.execute(sql`
    INSERT INTO rent_revision (id, organization_id, lease_id, index_name, reference_quarter,
                               previous_index_value, new_index_value, base_rent,
                               computed_rent_unrounded, proposed_rent, effective_on, status)
    VALUES (${REVISION_ID}::uuid, ${ORG_ID}::uuid, ${LEASE_ID}::uuid, 'irl', '2026-T1',
            145.170000, 149.030000, 700.00, 718.611558, 718.61, '2026-10-01', 'approved')
  `);
}

const decompteJob = {
  requestId: REQUEST_ID,
  organizationId: ORG_ID,
  template: "decompte" as const,
  documentId: DOCUMENT_ID,
  regularizationRunId: RUN_ID,
  leaseId: LEASE_ID,
};

const revisionJob = {
  requestId: REQUEST_ID,
  organizationId: ORG_ID,
  template: "revision" as const,
  documentId: DOCUMENT_ID,
  rentRevisionId: REVISION_ID,
};

describe("pdf.render payloads", () => {
  it("accepts what the charge and revision screens enqueue", () => {
    expect(PdfRenderData.parse(decompteJob).regularizationRunId).toBe(RUN_ID);
    expect(PdfRenderData.parse(revisionJob).rentRevisionId).toBe(REVISION_ID);
  });

  it("still accepts a receipt payload, which carries no document id", () => {
    const parsed = PdfRenderData.parse({
      requestId: REQUEST_ID,
      organizationId: ORG_ID,
      rentReceiptId: DOCUMENT_ID,
      template: "quittance",
    });
    expect(parsed.template).toBe("quittance");
  });

  it("rejects a decompte that names no run and no lease", () => {
    const result = PdfRenderData.safeParse({
      requestId: REQUEST_ID,
      organizationId: ORG_ID,
      template: "decompte",
      documentId: DOCUMENT_ID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "regularizationRunId",
      "leaseId",
    ]);
  });
});

run("pdf.render statement and letter sources", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
    await seedLease();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("builds the statement from the frozen run, with the tenant's own quote-parts", async () => {
    await seedRun(true);

    const source = await decompteSource(deps(), PdfRenderData.parse(decompteJob));

    expect(source.locataire.nom).toBe("Camille Martin");
    expect(source.lot).toEqual({
      designation: "LOT-A1 — Appartement A1",
      adresse: "1 rue Exemple, 64000 Pau",
    });
    // The occupancy is clipped to the run's period, not the lease's start.
    expect(source.occupancyStart).toBe("2026-01-01");
    expect(source.occupancyEnd).toBe("2026-12-31");
    expect(source.postings).toEqual([
      {
        label: "Entretien chaudière",
        recoverableAmount: "300.00",
        keyLabel: "Tantièmes chauffage",
        quotePart: "180.00",
      },
      {
        label: "Nettoyage des parties communes",
        recoverableAmount: "120.00",
        keyLabel: null,
        quotePart: "60.00",
      },
    ]);
    expect(source.totalCharges).toBe("240.00");
    expect(source.provisionsImpayees).toBe("20.00");

    const data = buildDecompteData(source);
    // The registered office is empty here: the key is absent, and `common.typ`
    // only prints it when it is there.
    expect(source.sci.adresse).toBeUndefined();
    expect("adresse" in data.sci).toBe(false);
    expect(source.lieu).toBe("Pau");
    expect(data.exercice).toBe("2026");
    expect(data.lignes[1]?.cle).toBe("Affectation directe");
    expect(data.solde).toBe("60.00");
    expect(data.libelleSolde).toBe("Trop-perçu à restituer");
  });

  it("refuses to edit a statement for a run that was never frozen", async () => {
    await seedRun(false);

    await expect(decompteSource(deps(), PdfRenderData.parse(decompteJob))).rejects.toThrow(
      /non gelée/,
    );
  });

  it("builds the revision letter with the index values and the signed variation", async () => {
    await seedRevision();

    const source = await revisionSource(deps(), PdfRenderData.parse(revisionJob));

    expect(source.indexLabel).toBe("IRL");
    expect(source.previousIndexValue).toBe("145.170000");
    expect(source.computedRentUnrounded).toBe("718.611558");
    expect(source.variation).toBe("18.61");
    expect(source.chargeAmount).toBe("80.00");
    expect(source.locataire.nom).toBe("Camille Martin");

    const data = buildRevisionData(source);
    expect(data.dateEffet).toBe("01/10/2026");
    expect(data.loyerRevise).toBe("718.61");
  });

  it("prints the registered office and issues from its city once they are filled", async () => {
    await setEntityAddress();
    await seedRun(true);
    await seedRevision();

    const statement = await decompteSource(deps(), PdfRenderData.parse(decompteJob));
    expect(statement.sci).toEqual({
      nom: "SCI Test",
      adresse: "12 avenue des Pyrénées, Bâtiment B, 64230 Lescar",
      siret: "123456789",
    });
    // The place of issue is the issuer's, not the property's.
    expect(statement.lieu).toBe("Lescar");
    expect(buildDecompteData(statement).sci.adresse).toBe(
      "12 avenue des Pyrénées, Bâtiment B, 64230 Lescar",
    );

    const letter = await revisionSource(deps(), PdfRenderData.parse(revisionJob));
    expect(buildRevisionData(letter).sci.adresse).toBe(
      "12 avenue des Pyrénées, Bâtiment B, 64230 Lescar",
    );
  });

  it("refuses a revision letter with no effective date", async () => {
    await seedRevision();
    await adminDb().db.execute(
      sql`UPDATE rent_revision SET effective_on = NULL WHERE id = ${REVISION_ID}::uuid`,
    );

    await expect(revisionSource(deps(), PdfRenderData.parse(revisionJob))).rejects.toThrow(
      /date d’effet/,
    );
  });
});
