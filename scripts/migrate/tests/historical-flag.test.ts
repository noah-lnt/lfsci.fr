import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../../../apps/worker/src/deps";
import { detectForOrganization } from "../../../apps/worker/src/jobs/arrearsDetect";
import { fakeDeps } from "../../../apps/worker/tests/fakes";
import { applyPlan, IMPORT_EVENT_TYPE } from "../src/apply";
import { readExistingRows } from "../src/existing";
import type { Plan } from "../src/model";
import { buildPlan } from "../src/plan";
import { createOdooSource } from "../src/sources/odoo";
import { createSpreadsheetSource } from "../src/sources/spreadsheet";
import {
  adminDb,
  appDb,
  closeDbs,
  ENTITY_ID,
  exec,
  ORG_ID,
  prepareDatabase,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "./db";
import { fakeOdoo, fixture, seedLedger } from "./helpers";

const run = TEST_DATABASE_URL ? describe : describe.skip;

/** Every imported term is due before this date: by date alone, all of them are overdue. */
const AS_OF = "2026-09-20";

function deps(): Deps {
  return fakeDeps({ db: appDb(), admin: adminDb(), now: () => new Date(`${AS_OF}T08:00:00.000Z`) });
}

async function planFromFixtures(): Promise<Plan> {
  const { server, client } = fakeOdoo();
  seedLedger(server);
  const reads = [
    await createOdooSource({ client }).read(),
    await createSpreadsheetSource([
      { kind: "tenants", path: fixture("tenants.csv") },
      { kind: "leases", path: fixture("leases.csv") },
      { kind: "meters", path: fixture("meters.csv") },
      { kind: "loans", path: fixture("loans.csv") },
    ]).read(),
  ];
  return buildPlan({
    organizationId: ORG_ID,
    reads,
    existing: await readExistingRows(appDb(), ORG_ID),
  });
}

run("historical import", () => {
  beforeAll(async () => {
    await prepareDatabase();
  }, 60_000);

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("writes the settled history flagged as an import, and arrears detection stays silent on it", async () => {
    const plan = await planFromFixtures();
    expect(plan.blockers).toEqual([]);
    const report = await applyPlan(appDb(), plan, { today: AS_OF });
    expect(report.written).toEqual({
      person: 3,
      supplier: 1,
      lease: 3,
      rent_term: 3,
      expense: 1,
      loan: 2,
      meter: 2,
    });
    expect(report.entities).toEqual([
      { entityId: ENTITY_ID, entityName: "SCI Exemple", written: 11 },
    ]);

    const terms = await exec(sql`
      SELECT t.status, to_char(t.due_on, 'YYYY-MM-DD') AS due_on, v.total_amount::text AS total,
             v.odoo_move_name, l.reference
        FROM rent_term t
        JOIN rent_term_version v ON v.id = t.current_version_id
        JOIN lease l ON l.id = t.lease_id
       ORDER BY t.due_on, v.odoo_move_name`);
    expect(terms).toEqual([
      {
        status: "settled",
        due_on: "2026-07-05",
        total: "780.00",
        odoo_move_name: "INV/2026/00023",
        reference: "BAIL-2024-001",
      },
      {
        status: "partially_settled",
        due_on: "2026-08-05",
        total: "780.00",
        odoo_move_name: "INV/2026/00024",
        reference: "BAIL-2024-001",
      },
      {
        status: "settled",
        due_on: "2026-08-05",
        total: "600.00",
        odoo_move_name: "INV/2026/00025",
        reference: "BAIL-ODOO-15",
      },
    ]);
    expect(
      await exec(
        sql`SELECT amount::text AS amount, confirmed_by_odoo, odoo_reconcile_ref FROM payment_allocation
             ORDER BY odoo_reconcile_ref`,
      ),
    ).toEqual([
      { amount: "780.00", confirmed_by_odoo: true, odoo_reconcile_ref: "INV/2026/00023" },
      { amount: "380.00", confirmed_by_odoo: true, odoo_reconcile_ref: "INV/2026/00024" },
      { amount: "600.00", confirmed_by_odoo: true, odoo_reconcile_ref: "INV/2026/00025" },
    ]);
    const events = await exec(sql`
      SELECT count(*)::int AS n, bool_and(origin = 'import') AS all_import,
             bool_and(is_migration_import) AS all_flagged, count(DISTINCT payload->>'batchId')::int AS batches
        FROM event WHERE type = ${IMPORT_EVENT_TYPE}`);
    expect(events).toEqual([{ n: 15, all_import: true, all_flagged: true, batches: 1 }]);
    expect(await exec(sql`SELECT origin FROM meter_reading`)).toEqual([{ origin: "import" }]);
    expect(await exec(sql`SELECT source FROM loan_schedule_version`)).toEqual([
      { source: "import" },
    ]);
    expect(await exec(sql`SELECT source_system FROM expense`)).toEqual([
      { source_system: "migration:odoo" },
    ]);

    const arrears = await detectForOrganization(deps(), ORG_ID, AS_OF);
    expect(arrears).toMatchObject({
      leases: 0,
      deadlinesWritten: 0,
      exceptionsOpened: 0,
      suspended: 0,
    });
    expect(await exec(sql`SELECT id FROM deadline`)).toEqual([]);
    expect(await exec(sql`SELECT id FROM inbox_item`)).toEqual([]);
    expect(await exec(sql`SELECT id FROM message_outbound`)).toEqual([]);
  });

  it("writes the unpaid history flagged, so the inherited debt exists without raising an arrear (TMP-04)", async () => {
    const plan = await planFromFixtures();
    await applyPlan(appDb(), plan, { today: AS_OF });
    expect(plan.deferrals.filter((d) => d.kind === "rent_term")).toEqual([]);

    const terms = await exec(sql`
      SELECT status, is_migration_import, due_on::text AS due_on FROM rent_term ORDER BY due_on, status`);
    expect(terms).toEqual([
      { status: "settled", is_migration_import: true, due_on: "2026-07-05" },
      { status: "partially_settled", is_migration_import: true, due_on: "2026-08-05" },
      { status: "settled", is_migration_import: true, due_on: "2026-08-05" },
    ]);
    // 780 invoiced, 400 still due in Odoo: the 380 already received is an allocation, the rest a debt.
    expect(
      await exec(sql`
        SELECT a.amount::text AS amount FROM payment_allocation a
          JOIN rent_term t ON t.id = a.rent_term_id
          JOIN lease l ON l.id = t.lease_id
         WHERE t.due_on = '2026-08-05' AND l.reference = 'BAIL-2024-001'`),
    ).toEqual([{ amount: "380.00" }]);

    const arrears = await detectForOrganization(deps(), ORG_ID, AS_OF);
    expect(arrears).toMatchObject({ leases: 0, deadlinesWritten: 0 });
    expect(await exec(sql`SELECT id FROM deadline`)).toEqual([]);

    const lease = await exec(sql`SELECT id FROM lease WHERE reference = 'BAIL-2024-001'`);
    const [term] = await exec(sql`
      INSERT INTO rent_term (organization_id, lease_id, kind, period_start, period_end, due_on, status)
      VALUES (${ORG_ID}::uuid, ${String(lease[0]?.id)}::uuid, 'rent', '2026-09-01', '2026-09-30', '2026-09-05', 'posted')
      RETURNING id`);
    const [version] = await exec(sql`
      INSERT INTO rent_term_version (organization_id, rent_term_id, sequence, rent_amount, total_amount, reason)
      VALUES (${ORG_ID}::uuid, ${String(term?.id)}::uuid, 1, 780.00, 780.00, 'initial') RETURNING id`);
    await exec(
      sql`UPDATE rent_term SET current_version_id = ${String(version?.id)}::uuid WHERE id = ${String(term?.id)}::uuid`,
    );

    // A term the app itself produced after the cut-over is still detected.
    const after = await detectForOrganization(deps(), ORG_ID, AS_OF);
    expect(after).toMatchObject({ leases: 1, deadlinesWritten: 1 });
  });

  it("writes nothing twice: a second apply of the same plan only counts what a previous batch traced", async () => {
    const plan = await planFromFixtures();
    await applyPlan(appDb(), plan, { today: AS_OF });
    const again = await applyPlan(appDb(), plan, { today: AS_OF });
    expect(again.written).toEqual({});
    expect(again.alreadyImported).toBe(15);
    expect(await exec(sql`SELECT count(*)::int AS n FROM rent_term`)).toEqual([{ n: 3 }]);
    expect(await exec(sql`SELECT count(*)::int AS n FROM person`)).toEqual([{ n: 3 }]);
  });
});
