import { claimBalance } from "@lfsci/domain";
import { createOdooClient, createOdooOperations } from "@lfsci/odoo";
import { createFakeOdoo } from "@lfsci/odoo/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../../src/deps";
import { backsyncOrganization } from "../../src/jobs/odooBacksync";
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
import { fakeBoss, fakeDeps } from "../fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const CLAIM_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_CLAIM_ID = "50000000-0000-4000-8000-000000000002";
const REFERENCE = "SIN-2026-001";

function odooDeps(server: ReturnType<typeof createFakeOdoo>): Deps {
  const client = createOdooClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    database: server.database,
    fetch: server.fetch,
    ratePerSecond: 0,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  return fakeDeps({
    db: appDb(),
    admin: adminDb(),
    boss: fakeBoss(),
    odoo: {
      client,
      operations: createOdooOperations(client, { lockCacheMs: 0 }),
      database: server.database,
      timeoutMs: 30_000,
    },
    now: () => new Date(),
  });
}

async function seedClaim(input: { id?: string; reference?: string | null } = {}): Promise<void> {
  await adminDb().db.execute(sql`
    INSERT INTO claim (id, organization_id, reference, occurred_on, status)
    VALUES (${input.id ?? CLAIM_ID}::uuid, ${ORG_ID}::uuid,
            ${input.reference === undefined ? REFERENCE : input.reference},
            '2026-08-12', 'open')
  `);
}

type MoveInput = {
  id: number;
  ref?: string;
  moveType?: string;
  state?: string;
  amount?: number;
  date?: string;
};

function seedMove(server: ReturnType<typeof createFakeOdoo>, input: MoveInput): void {
  server.seed("account.move", [
    {
      id: input.id,
      move_type: input.moveType ?? "entry",
      state: input.state ?? "posted",
      ref: input.ref ?? false,
      date: input.date ?? "2026-09-15",
      amount_total: input.amount ?? 1200,
      amount_residual: 0,
      write_date: `2026-09-16 08:0${input.id}:00`,
    },
  ]);
}

type IndemnityRow = {
  amount: string;
  currency: string;
  received_on: string | null;
  kind: string;
  payment_id: string | null;
};

async function indemnities(): Promise<IndemnityRow[]> {
  const rows = await adminDb().db.execute<IndemnityRow>(sql`
    SELECT amount, currency, received_on, kind, payment_id
      FROM claim_indemnity ORDER BY amount DESC
  `);
  return [...rows];
}

/** The back-sync only re-reads a move once its cursor no longer excludes it. */
async function forgetCursor(): Promise<void> {
  await adminDb().db.execute(sql`DELETE FROM integration_cursor`);
}

async function mappedTable(externalId: number): Promise<string | undefined> {
  const rows = await adminDb().db.execute<{ internal_table: string }>(sql`
    SELECT internal_table FROM external_ref
     WHERE model = 'account.move' AND external_id = ${String(externalId)}
  `);
  return [...rows][0]?.internal_table;
}

run("claim indemnities written by the back-sync", () => {
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

  it("writes the indemnity of a posted move whose reference names the claim", async () => {
    await seedClaim();
    const server = createFakeOdoo();
    seedMove(server, { id: 101, ref: REFERENCE });

    const result = await backsyncOrganization(odooDeps(server), ORG_ID);

    expect(result.indemnities).toBe(1);
    expect(await indemnities()).toEqual([
      {
        amount: "1200.00",
        currency: "EUR",
        received_on: "2026-09-15",
        kind: "advance",
        // No payment row is invented: it would read as an unallocated payment for ever.
        payment_id: null,
      },
    ]);
    expect(await mappedTable(101)).toBe("claim_indemnity");
  });

  it("does not write the same cash twice when the move is read again", async () => {
    await seedClaim();
    const server = createFakeOdoo();
    seedMove(server, { id: 102, ref: REFERENCE });
    const deps = odooDeps(server);

    await backsyncOrganization(deps, ORG_ID);
    await forgetCursor();
    const second = await backsyncOrganization(deps, ORG_ID);

    expect(second.indemnities).toBe(0);
    expect(await indemnities()).toHaveLength(1);
  });

  it("reports a customer credit note apart from the cash received", async () => {
    await seedClaim();
    const server = createFakeOdoo();
    seedMove(server, { id: 103, ref: REFERENCE, amount: 1200 });
    seedMove(server, { id: 104, ref: REFERENCE, amount: 800 });
    seedMove(server, { id: 105, ref: REFERENCE, amount: 300, moveType: "out_refund" });

    await backsyncOrganization(odooDeps(server), ORG_ID);

    const rows = await indemnities();
    expect(rows.map((row) => [row.kind, row.amount])).toEqual([
      ["advance", "1200.00"],
      ["complement", "800.00"],
      ["deductible", "300.00"],
    ]);
    const balance = claimBalance({
      expenses: [],
      indemnities: rows.map((row, index) => ({
        id: String(index),
        amount: row.amount,
        kind: row.kind,
      })),
    });
    expect(balance.grossIndemnities).toBe("2000.00");
    expect(balance.deductible).toBe("300.00");
  });

  it("leaves a supplier bill and a draft entry alone", async () => {
    await seedClaim();
    const server = createFakeOdoo();
    seedMove(server, { id: 106, ref: REFERENCE, moveType: "in_invoice" });
    seedMove(server, { id: 107, ref: REFERENCE, state: "draft" });

    const result = await backsyncOrganization(odooDeps(server), ORG_ID);

    expect(result.indemnities).toBe(0);
    expect(await indemnities()).toEqual([]);
  });

  it("refuses to choose when two claims answer to the same reference", async () => {
    await seedClaim();
    await seedClaim({ id: OTHER_CLAIM_ID });
    const server = createFakeOdoo();
    seedMove(server, { id: 108, ref: REFERENCE });

    const result = await backsyncOrganization(odooDeps(server), ORG_ID);

    expect(result.exceptions).toBe(1);
    expect(await indemnities()).toEqual([]);
    const inbox = await adminDb().db.execute<{ status: string; uncertainty_reason: string }>(
      sql`SELECT status, uncertainty_reason FROM inbox_item`,
    );
    expect([...inbox][0]?.status).toBe("ambiguous");
    expect([...inbox][0]?.uncertainty_reason).toContain(REFERENCE);
  });

  it("attributes a move that was parked on the legal entity before the claim was referenced", async () => {
    await seedClaim({ reference: null });
    const server = createFakeOdoo();
    seedMove(server, { id: 109, ref: REFERENCE });
    const deps = odooDeps(server);

    await backsyncOrganization(deps, ORG_ID);
    expect(await mappedTable(109)).toBe("legal_entity");
    expect(await indemnities()).toEqual([]);

    await adminDb().db.execute(
      sql`UPDATE claim SET reference = ${REFERENCE} WHERE id = ${CLAIM_ID}::uuid`,
    );
    await forgetCursor();
    const second = await backsyncOrganization(deps, ORG_ID);

    expect(second.indemnities).toBe(1);
    expect(await mappedTable(109)).toBe("claim_indemnity");
    expect((await indemnities())[0]?.amount).toBe("1200.00");
  });
});

run("the legal entity mapping is not a claim attribution", () => {
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

  it("keeps a move with no reference on the entity", async () => {
    await seedClaim();
    const server = createFakeOdoo();
    seedMove(server, { id: 110 });

    await backsyncOrganization(odooDeps(server), ORG_ID);

    expect(await indemnities()).toEqual([]);
    expect(await mappedTable(110)).toBe("legal_entity");
    const entities = await adminDb().db.execute<{ id: string }>(
      sql`SELECT id FROM legal_entity WHERE id = ${ENTITY_ID}::uuid`,
    );
    expect([...entities]).toHaveLength(1);
  });
});
