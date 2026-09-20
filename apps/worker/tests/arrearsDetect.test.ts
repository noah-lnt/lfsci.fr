import { withoutTenant } from "@lfsci/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../src/deps";
import { collectArrears, detectForOrganization } from "../src/jobs/arrearsDetect";
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
} from "./db";
import { fakeDeps } from "./fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const AS_OF = "2026-09-20";
const LEASE_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const TERM_ID = "33333333-3333-4333-8333-333333333333";

function deps(): Deps {
  return fakeDeps({ db: appDb(), admin: adminDb(), now: () => new Date(`${AS_OF}T08:00:00.000Z`) });
}

async function exec(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  return withoutTenant(adminDb(), async (tx) => [...(await tx.execute(query))]);
}

/** One active lease, one term due 40 days before `AS_OF`, nothing allocated. */
async function seedOverdueLease(options: { leaseStatus?: string; termStatus?: string } = {}) {
  await exec(sql`
    INSERT INTO person (id, organization_id, display_name)
    VALUES (${PERSON_ID}::uuid, ${ORG_ID}::uuid, 'Camille Martin')`);
  await exec(sql`
    INSERT INTO contact_point (organization_id, person_id, kind, value, is_primary)
    VALUES (${ORG_ID}::uuid, ${PERSON_ID}::uuid, 'email', 'camille@example.test', true)`);
  await exec(sql`
    INSERT INTO lease (id, organization_id, legal_entity_id, reference, kind, status,
                       starts_on, rent_excl_charges, charge_amount, currency, payment_day)
    VALUES (${LEASE_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'BAIL-TEST-001', 'bare',
            ${options.leaseStatus ?? "active"}, '2026-01-01', 700.00, 80.00, 'EUR', 5)`);
  await exec(sql`
    INSERT INTO lease_party (organization_id, lease_id, person_id, role, starts_on,
                             is_billing_contact)
    VALUES (${ORG_ID}::uuid, ${LEASE_ID}::uuid, ${PERSON_ID}::uuid, 'holder', '2026-01-01', true)`);
  await exec(sql`
    INSERT INTO rent_term (id, organization_id, lease_id, kind, period_start, period_end,
                           due_on, status)
    VALUES (${TERM_ID}::uuid, ${ORG_ID}::uuid, ${LEASE_ID}::uuid, 'rent', '2026-08-01',
            '2026-08-31', '2026-08-11', ${options.termStatus ?? "posted"})`);
  const version = await exec(sql`
    INSERT INTO rent_term_version (organization_id, rent_term_id, sequence, rent_amount,
                                   charge_amount, accessory_amount, total_amount, currency, reason)
    VALUES (${ORG_ID}::uuid, ${TERM_ID}::uuid, 1, 700.00, 80.00, 0.00, 780.00, 'EUR', 'initial')
    RETURNING id`);
  await exec(sql`
    UPDATE rent_term SET current_version_id = ${String(version[0]?.id)}::uuid
     WHERE id = ${TERM_ID}::uuid`);
}

async function deadlineRows(): Promise<Record<string, unknown>[]> {
  return exec(sql`SELECT * FROM deadline ORDER BY id`);
}

async function inboxRows(): Promise<Record<string, unknown>[]> {
  return exec(sql`SELECT * FROM inbox_item ORDER BY id`);
}

run("arrears.detect", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("reports what is due and unpaid, with its qualification and ageing", async () => {
    await seedOverdueLease();
    const arrears = await collectArrears(deps(), ORG_ID, AS_OF);

    expect(arrears).toHaveLength(1);
    expect(arrears[0]).toMatchObject({
      leaseId: LEASE_ID,
      leaseReference: "BAIL-TEST-001",
      tenantName: "Camille Martin",
      tenantEmail: "camille@example.test",
      outstanding: "780.00",
      oldestDueOn: "2026-08-11",
      daysLate: 40,
      qualification: "due",
      suspended: false,
    });
    expect(arrears[0]?.terms).toHaveLength(1);
  });

  it("ignores a term whose allocations cover it", async () => {
    await seedOverdueLease();
    const payment = await exec(sql`
      INSERT INTO payment (organization_id, legal_entity_id, direction, amount, received_on, status)
      VALUES (${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'inbound', 780.00, '2026-08-20', 'allocated')
      RETURNING id`);
    await exec(sql`
      INSERT INTO payment_allocation (organization_id, payment_id, rent_term_id, amount,
                                      allocated_on, confirmed_by_odoo)
      VALUES (${ORG_ID}::uuid, ${String(payment[0]?.id)}::uuid, ${TERM_ID}::uuid, 780.00,
              '2026-08-20', true)`);

    expect(await collectArrears(deps(), ORG_ID, AS_OF)).toEqual([]);
  });

  it("writes the deadline once: a second run the same day changes nothing", async () => {
    await seedOverdueLease();

    const first = await detectForOrganization(deps(), ORG_ID, AS_OF);
    expect(first).toMatchObject({ leases: 1, deadlinesWritten: 1, exceptionsOpened: 0 });
    const afterFirst = await deadlineRows();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({ type: "rent_arrears", status: "to_process" });

    const second = await detectForOrganization(deps(), ORG_ID, AS_OF);
    expect(second).toMatchObject({
      leases: 1,
      deadlinesWritten: 0,
      deadlinesClosed: 0,
      exceptionsOpened: 0,
    });
    expect(await deadlineRows()).toEqual(afterFirst);
    expect(await inboxRows()).toEqual([]);
  });

  it("opens one exception, and only one, when the automation is suspended", async () => {
    await seedOverdueLease({ leaseStatus: "disputed" });

    const first = await detectForOrganization(deps(), ORG_ID, AS_OF);
    expect(first).toMatchObject({ suspended: 1, exceptionsOpened: 1 });
    const afterFirst = await inboxRows();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      status: "ambiguous",
      proposed_action: "review_arrears_suspension",
    });

    const second = await detectForOrganization(deps(), ORG_ID, AS_OF);
    expect(second).toMatchObject({ exceptionsOpened: 0, deadlinesWritten: 0 });
    expect(await inboxRows()).toEqual(afterFirst);
  });

  it("closes the deadline once the arrear is settled", async () => {
    await seedOverdueLease();
    await detectForOrganization(deps(), ORG_ID, AS_OF);

    await exec(sql`UPDATE rent_term SET status = 'settled' WHERE id = ${TERM_ID}::uuid`);
    const after = await detectForOrganization(deps(), ORG_ID, AS_OF);

    expect(after).toMatchObject({ leases: 0, deadlinesClosed: 1 });
    expect((await deadlineRows())[0]).toMatchObject({ status: "cancelled" });
  });
});
