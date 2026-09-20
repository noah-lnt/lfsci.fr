import { createCommand, enqueueOutbox, transitionCommand, withTenant } from "@lfsci/db";
import { newId } from "@lfsci/kernel";
import { createOdooClient, createOdooOperations } from "@lfsci/odoo";
import { createFakeOdoo } from "@lfsci/odoo/testing";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDeps } from "../src/deps";
import { createDbExchangeRecorder } from "../src/exchange-recorder";
import { outboxDispatch } from "../src/jobs/outboxDispatch";
import { registerAll } from "../src/jobs/registry";
import {
  adminDb,
  appDb,
  closeDbs,
  EXPENSE_ID,
  migrate,
  ORG_ID,
  requireUrl,
  SUPPLIER_REFERENCE,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "./db";
import { fakeEnv } from "./fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const PGBOSS_SCHEMA = "pgboss_test";

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("condition not met before the timeout");
}

run("outbox.dispatch end to end on pg-boss and the real database", () => {
  let boss: PgBoss;

  beforeAll(async () => {
    await migrate();
    await truncateAll();
    await adminDb().db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${PGBOSS_SCHEMA} CASCADE`));
    await seedOrganization();
    boss = new PgBoss({ connectionString: requireUrl(), schema: PGBOSS_SCHEMA });
    await boss.start();
  }, 120_000);

  afterAll(async () => {
    await boss?.stop({ graceful: true });
    await adminDb().db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${PGBOSS_SCHEMA} CASCADE`));
    await closeDbs();
  }, 60_000);

  it("takes an enqueued job through the fake Odoo to a confirmed command", async () => {
    const fake = createFakeOdoo();
    fake.seed("res.partner", [{ id: 7, name: "Fournisseur test", ref: SUPPLIER_REFERENCE }]);

    const client = createOdooClient({
      baseUrl: fake.baseUrl,
      apiKey: fake.apiKey,
      fetch: fake.fetch,
      ratePerSecond: 50,
      recorder: createDbExchangeRecorder(appDb()),
    });

    const deps = buildDeps({ env: fakeEnv, db: appDb(), admin: adminDb(), boss });
    deps.odoo = {
      client,
      operations: createOdooOperations(client),
      database: "lfsci-test",
      timeoutMs: 30_000,
    };

    await registerAll(boss, deps, [outboxDispatch]);

    const requestId = newId();
    const command = await withTenant(appDb(), { organizationId: ORG_ID }, async (tx) => {
      const prepared = await createCommand(tx, {
        organizationId: ORG_ID,
        commandType: "post_supplier_bill",
        operationKey: `post_supplier_bill:${newId()}`,
        payload: {
          expenseId: EXPENSE_ID,
          supplierReference: SUPPLIER_REFERENCE,
          issuedOn: "2026-09-01",
          totalExclTax: "100.00",
          totalInclTax: "120.00",
          currency: "EUR",
        },
        autonomyLevel: "C",
        status: "prepared",
        correlationId: requestId,
      });
      const authorized = await transitionCommand(
        tx,
        prepared.id,
        "prepared",
        "authorized",
        prepared.version,
      );
      await enqueueOutbox(tx, {
        organizationId: ORG_ID,
        kind: "odoo",
        commandId: authorized.id,
        payload: authorized.payload,
        payloadHash: authorized.payloadHash,
      });
      return authorized;
    });

    await boss.send(outboxDispatch.name, { requestId, organizationId: ORG_ID, limit: 10 });

    const confirmed = await waitFor(async () => {
      const rows = await adminDb().db.execute<{ status: string; external_ref_id: string | null }>(
        sql`SELECT status, external_ref_id FROM command WHERE id = ${command.id}::uuid`,
      );
      const row = [...rows][0];
      return row?.status === "confirmed" ? row : undefined;
    });
    expect(confirmed.external_ref_id).not.toBeNull();

    const refs = await adminDb().db.execute<{ model: string; external_id: string }>(
      sql`SELECT model, external_id FROM external_ref WHERE internal_id = ${EXPENSE_ID}::uuid`,
    );
    expect([...refs][0]?.model).toBe("account.move");

    const exchanges = await adminDb().db.execute<{
      operation: string;
      status: string;
      request_id: string;
      command_id: string | null;
    }>(sql`SELECT operation, status, request_id, command_id FROM integration_exchange
            WHERE command_id = ${command.id}::uuid ORDER BY created_at`);
    const rows = [...exchanges];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((row) => row.operation)).toContain("account.move.create");
    for (const row of rows) {
      expect(row.status).toBe("success");
      expect(row.request_id).toBe(requestId);
    }

    const outbox = await adminDb().db.execute<{ status: string }>(
      sql`SELECT status FROM outbox_entry WHERE command_id = ${command.id}::uuid`,
    );
    expect([...outbox][0]?.status).toBe("confirmed");
  }, 120_000);
});
