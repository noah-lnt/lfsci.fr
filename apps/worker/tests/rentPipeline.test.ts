import type { CommandRow, OutboxRow } from "@lfsci/db";
import { createCommand, enqueueOutbox, transitionCommand, withTenant } from "@lfsci/db";
import { AppError, newId, runWithCorrelation } from "@lfsci/kernel";
import { createOdooClient, createOdooOperations } from "@lfsci/odoo";
import { createFakeOdoo } from "@lfsci/odoo/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../src/deps";
import { backsyncOrganization, mirrorJournalBalances } from "../src/jobs/odooBacksync";
import { dispatchEntry, odooBreaker } from "../src/jobs/outboxDispatch";
import { reconcileOnce } from "../src/jobs/outboxReconcile";
import {
  adminDb,
  appDb,
  closeDbs,
  ENTITY_ID,
  EXPENSE_ID,
  migrate,
  ORG_ID,
  SUPPLIER_REFERENCE,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "./db";
import { fakeBoss, fakeDeps } from "./fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const BUILDING_ID = "e1111111-0000-4000-8000-000000000001";
const UNIT_ID = "e2222222-0000-4000-8000-000000000002";
const PERSON_ID = "e3333333-0000-4000-8000-000000000003";
const LEASE_ID = "e4444444-0000-4000-8000-000000000004";
const TERM_ID = "e5555555-0000-4000-8000-000000000005";
const VERSION_ID = "e6666666-0000-4000-8000-000000000006";
const ODOO_COMPANY_ID = 1;

const UNIT_B_ID = "e7777777-0000-4000-8000-000000000007";
const CCA_ID = "e8888888-0000-4000-8000-000000000008";
const MOVEMENT_ID = "e9999999-0000-4000-8000-000000000009";

async function seedExpenseDetail(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO unit (id, organization_id, building_id, code, label, kind)
    VALUES (${UNIT_B_ID}::uuid, ${ORG_ID}::uuid, ${BUILDING_ID}::uuid, 'LOT-B2', 'Appartement B2', 'dwelling')
  `);
  const lines = [
    {
      number: 1,
      description: "Entretien chaudière",
      amount: "80.00",
      shares: [
        [UNIT_ID, "60.00"],
        [UNIT_B_ID, "20.00"],
      ],
    },
    { number: 2, description: "Déplacement", amount: "20.00", shares: [[UNIT_ID, "20.00"]] },
  ] as const;

  // `expense_allocation_balanced` is a deferred constraint trigger: the line and
  // its shares only balance at COMMIT, so they are written in one transaction.
  await db.transaction(async (tx) => {
    for (const line of lines) {
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO expense_line (organization_id, expense_id, line_number, description,
                                  amount_excl_tax, amount_incl_tax)
        VALUES (${ORG_ID}::uuid, ${EXPENSE_ID}::uuid, ${line.number}, ${line.description},
                ${line.amount}::numeric, ${line.amount}::numeric)
        RETURNING id
      `);
      const lineId = [...rows][0]?.id;
      for (const [unitId, amount] of line.shares) {
        await tx.execute(sql`
          INSERT INTO expense_allocation (organization_id, expense_line_id, target, unit_id, amount)
          VALUES (${ORG_ID}::uuid, ${lineId}::uuid, 'unit', ${unitId}::uuid, ${amount}::numeric)
        `);
      }
    }
  });
}

const RECEIPT_ID = "ea000000-0000-4000-8000-00000000000a";
const DOCUMENT_ID = "eb000000-0000-4000-8000-00000000000b";

async function seedReceipt(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO document (id, organization_id, title, nature)
    VALUES (${DOCUMENT_ID}::uuid, ${ORG_ID}::uuid, 'quittance-2026-09-01.pdf', 'rent_receipt')
  `);
  await db.execute(sql`
    INSERT INTO document_version (organization_id, document_id, sequence, role, storage_key,
                                  content_type, byte_size, sha256)
    VALUES (${ORG_ID}::uuid, ${DOCUMENT_ID}::uuid, 1, 'original', 'org/quittance.pdf',
            'application/pdf', 1024, repeat('a', 64))
  `);
  await db.execute(sql`
    INSERT INTO rent_receipt (id, organization_id, lease_id, kind, period_start, period_end,
                              rent_amount, charge_amount, total_amount, issued_on, document_id)
    VALUES (${RECEIPT_ID}::uuid, ${ORG_ID}::uuid, ${LEASE_ID}::uuid, 'quittance', '2026-09-01',
            '2026-09-30', 700.00, 80.00, 780.00, '2026-10-01', ${DOCUMENT_ID}::uuid)
  `);
}

async function seedCca(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO partner_current_account (id, organization_id, legal_entity_id, partner_person_id)
    VALUES (${CCA_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, ${PERSON_ID}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO cca_movement (id, organization_id, cca_id, kind, amount, occurred_on, status)
    VALUES (${MOVEMENT_ID}::uuid, ${ORG_ID}::uuid, ${CCA_ID}::uuid, 'contribution', 1500.00, '2026-09-10', 'validated')
  `);
}

async function seedCommand(
  commandType: string,
  payload: Record<string, unknown>,
): Promise<{ command: CommandRow; entry: OutboxRow }> {
  return withTenant(appDb(), { organizationId: ORG_ID }, async (tx) => {
    const prepared = await createCommand(tx, {
      organizationId: ORG_ID,
      commandType,
      operationKey: `${commandType}:${newId()}`,
      payload,
      autonomyLevel: "C",
      status: "prepared",
    });
    const command = await transitionCommand(
      tx,
      prepared.id,
      "prepared",
      "authorized",
      prepared.version,
    );
    const entry = await enqueueOutbox(tx, {
      organizationId: ORG_ID,
      kind: "odoo",
      commandId: command.id,
      payload: command.payload,
      payloadHash: command.payloadHash,
    });
    return { command, entry };
  });
}

async function seedLease(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    UPDATE legal_entity SET odoo_company_id = ${ODOO_COMPANY_ID} WHERE id = ${ENTITY_ID}::uuid
  `);
  await db.execute(sql`
    INSERT INTO building (id, organization_id, legal_entity_id, code, name, address_line1)
    VALUES (${BUILDING_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'BAT-1', 'Résidence test', '1 rue Exemple')
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
            '2026-01-01', 700.00, 80.00, 5)
  `);
  await db.execute(sql`
    INSERT INTO lease_party (organization_id, lease_id, person_id, role, starts_on, is_billing_contact)
    VALUES (${ORG_ID}::uuid, ${LEASE_ID}::uuid, ${PERSON_ID}::uuid, 'holder', '2026-01-01', true)
  `);
  await db.execute(sql`
    INSERT INTO lease_unit (organization_id, lease_id, unit_id, role, starts_on)
    VALUES (${ORG_ID}::uuid, ${LEASE_ID}::uuid, ${UNIT_ID}::uuid, 'main', '2026-01-01')
  `);
  await db.execute(sql`
    INSERT INTO rent_term (id, organization_id, lease_id, kind, period_start, period_end, due_on, status)
    VALUES (${TERM_ID}::uuid, ${ORG_ID}::uuid, ${LEASE_ID}::uuid, 'rent', '2026-09-01', '2026-09-30', '2026-09-05', 'authorized')
  `);
  await db.execute(sql`
    INSERT INTO rent_term_version (id, organization_id, rent_term_id, sequence, rent_amount,
                                   charge_amount, accessory_amount, total_amount, reason)
    VALUES (${VERSION_ID}::uuid, ${ORG_ID}::uuid, ${TERM_ID}::uuid, 1, 700.00, 80.00, 0.00, 780.00, 'initial')
  `);
  await db.execute(sql`
    UPDATE rent_term SET current_version_id = ${VERSION_ID}::uuid WHERE id = ${TERM_ID}::uuid
  `);
}

function rentPayload() {
  return {
    rentTermId: TERM_ID,
    kind: "rent",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    dueOn: "2026-09-05",
    rentAmount: "700.00",
    chargeAmount: "80.00",
    accessoryAmount: "0.00",
    totalAmount: "780.00",
    currency: "EUR",
  };
}

async function seedRentCommand(
  options: { expectedVersion?: number } = {},
): Promise<{ command: CommandRow; entry: OutboxRow }> {
  return withTenant(appDb(), { organizationId: ORG_ID }, async (tx) => {
    const prepared = await createCommand(tx, {
      organizationId: ORG_ID,
      commandType: "prepare_rent_accounting",
      operationKey: `prepare_rent_accounting:${newId()}`,
      payload: rentPayload(),
      autonomyLevel: "C",
      status: "prepared",
      ...(options.expectedVersion === undefined
        ? {}
        : { expectedVersion: options.expectedVersion }),
    });
    const command = await transitionCommand(
      tx,
      prepared.id,
      "prepared",
      "authorized",
      prepared.version,
    );
    const entry = await enqueueOutbox(tx, {
      organizationId: ORG_ID,
      kind: "odoo",
      commandId: command.id,
      payload: command.payload,
      payloadHash: command.payloadHash,
    });
    return { command, entry };
  });
}

const REVISION_ID = "ec000000-0000-4000-8000-00000000000c";
const NEXT_TERM_ID = "ed000000-0000-4000-8000-00000000000d";

async function seedRevision(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO rent_term (id, organization_id, lease_id, kind, period_start, period_end, due_on, status)
    VALUES (${NEXT_TERM_ID}::uuid, ${ORG_ID}::uuid, ${LEASE_ID}::uuid, 'rent', '2026-10-01',
            '2026-10-31', '2026-10-05', 'planned')
  `);
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO rent_term_version (organization_id, rent_term_id, sequence, rent_amount,
                                   charge_amount, accessory_amount, total_amount, reason)
    VALUES (${ORG_ID}::uuid, ${NEXT_TERM_ID}::uuid, 1, 700.00, 80.00, 0.00, 780.00, 'initial')
    RETURNING id
  `);
  await db.execute(sql`
    UPDATE rent_term SET current_version_id = ${[...inserted][0]?.id}::uuid
     WHERE id = ${NEXT_TERM_ID}::uuid
  `);
  await db.execute(sql`
    INSERT INTO rent_revision (id, organization_id, lease_id, index_name, reference_quarter,
                               previous_index_value, new_index_value, base_rent,
                               computed_rent_unrounded, proposed_rent, effective_on, status)
    VALUES (${REVISION_ID}::uuid, ${ORG_ID}::uuid, ${LEASE_ID}::uuid, 'irl', '2026-T1',
            145.170000, 149.030000, 700.00, 718.611558, 718.61, '2026-10-01', 'approved')
  `);
}

function revisionPayload() {
  return {
    leaseId: LEASE_ID,
    rentRevisionId: REVISION_ID,
    indexName: "irl",
    referenceQuarter: "2026-T1",
    previousIndexValue: "145.170000",
    newIndexValue: "149.030000",
    baseRent: "700.00",
    proposedRent: "718.61",
    currency: "EUR",
    effectiveOn: "2026-10-01",
  };
}

type TermVersionRow = {
  sequence: number;
  rent_amount: string;
  total_amount: string;
  reason: string;
  is_current: boolean;
};

async function termVersions(termId: string): Promise<TermVersionRow[]> {
  const rows = await adminDb().db.execute<TermVersionRow>(sql`
    SELECT v.sequence, v.rent_amount, v.total_amount, v.reason,
           (t.current_version_id = v.id) AS is_current
      FROM rent_term_version v
      JOIN rent_term t ON t.id = v.rent_term_id
     WHERE v.rent_term_id = ${termId}::uuid
     ORDER BY v.sequence
  `);
  return [...rows];
}

async function seedTermCommand(
  termId: string,
  status: "prepared" | "confirmed",
): Promise<CommandRow> {
  return withTenant(appDb(), { organizationId: ORG_ID }, async (tx) => {
    const prepared = await createCommand(tx, {
      organizationId: ORG_ID,
      commandType: "prepare_rent_accounting",
      operationKey: `prepare_rent_accounting:${termId}:${status}`,
      payload: {
        rentTermId: termId,
        kind: "rent",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        dueOn: "2026-10-05",
        rentAmount: "700.00",
        chargeAmount: "80.00",
        accessoryAmount: "0.00",
        totalAmount: "780.00",
        currency: "EUR",
      },
      autonomyLevel: "C",
      status: "prepared",
    });
    await enqueueOutbox(tx, {
      organizationId: ORG_ID,
      kind: "odoo",
      commandId: prepared.id,
      payload: prepared.payload,
      payloadHash: prepared.payloadHash,
    });
    if (status === "prepared") return prepared;
    const sent = await transitionCommand(tx, prepared.id, "prepared", "sent", prepared.version);
    return transitionCommand(tx, sent.id, "sent", "confirmed", sent.version);
  });
}

type CommandStateRow = {
  id: string;
  status: string;
  version: number;
  error_type: string | null;
  rent_amount: string | null;
  outbox_status: string | null;
};

async function commandsForTerm(termId: string): Promise<CommandStateRow[]> {
  const rows = await adminDb().db.execute<CommandStateRow>(sql`
    SELECT c.id, c.status, c.version, c.error_type,
           c.payload ->> 'rentAmount' AS rent_amount,
           o.status AS outbox_status
      FROM command c
      LEFT JOIN outbox_entry o ON o.command_id = c.id
     WHERE c.command_type = 'prepare_rent_accounting'
       AND c.payload ->> 'rentTermId' = ${termId}
     ORDER BY c.created_at
  `);
  return [...rows];
}

function odooDeps(server: ReturnType<typeof createFakeOdoo>): Deps {
  const client = createOdooClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    database: server.database,
    fetch: server.fetch,
    // The production token bucket would make each of these calls wait a second.
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

async function readCommand(id: string): Promise<{ status: string; errorType: string | null }> {
  const rows = await adminDb().db.execute<{ status: string; errorType: string | null }>(sql`
    SELECT status, error_type AS "errorType" FROM command WHERE id = ${id}::uuid
  `);
  const row = [...rows][0];
  if (!row) throw new Error("command not found");
  return row;
}

run("rent pipeline against the real database and a fake Odoo", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
    await seedLease();
    odooBreaker.recordSuccess();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("posts the rent invoice, maps the move and marks the term posted", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    const { command, entry } = await seedRentCommand();

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(outcome).toBe("confirmed");
    expect((await readCommand(command.id)).status).toBe("confirmed");

    const move = server.records("account.move")[0];
    expect(move?.state).toBe("posted");
    expect(move?.x_lfsci_ref).toBe(`lfsci:${command.id}`);
    expect(move?.amount_total).toBe(780);
    const lines = move?.invoice_line_ids as [number, number, Record<string, unknown>][];
    expect(lines.map((line) => line[2].name)).toEqual(["Loyer", "Provisions sur charges"]);

    const analytic = server.records("account.analytic.account")[0];
    expect(analytic?.code).toBe("LOT-A1");
    expect(lines[0]?.[2]?.analytic_distribution).toEqual({ [String(analytic?.id)]: 100 });

    // The tenant reached Odoo as a partner keyed by the person's id.
    const partner = server.records("res.partner")[0];
    expect(partner?.ref).toBe(`LFSCI-PERS-${PERSON_ID}`);
    const persons = await adminDb().db.execute<{ odoo_partner_id: number }>(
      sql`SELECT odoo_partner_id FROM person WHERE id = ${PERSON_ID}::uuid`,
    );
    expect([...persons][0]?.odoo_partner_id).toBe(partner?.id);

    const terms = await adminDb().db.execute<{ status: string; odoo_move_id: number }>(sql`
      SELECT t.status, v.odoo_move_id
        FROM rent_term t JOIN rent_term_version v ON v.id = t.current_version_id
       WHERE t.id = ${TERM_ID}::uuid
    `);
    expect([...terms][0]).toMatchObject({ status: "posted", odoo_move_id: move?.id });

    const refs = await adminDb().db.execute<{ model: string; internal_table: string }>(
      sql`SELECT model, internal_table FROM external_ref WHERE internal_id = ${TERM_ID}::uuid`,
    );
    expect([...refs][0]).toMatchObject({ model: "account.move", internal_table: "rent_term" });
  });

  it("refuses a locked period before any write reaches Odoo", async () => {
    const server = createFakeOdoo();
    server.setLockDates({ hard_lock_date: "2026-09-30" });
    const deps = odooDeps(server);
    const { command, entry } = await seedRentCommand();

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(outcome).toBe("rejected");
    expect(await readCommand(command.id)).toMatchObject({
      status: "rejected",
      errorType: "closed_period",
    });
    expect(server.records("account.move")).toEqual([]);
    expect(odooBreaker.consecutiveFailures()).toBe(0);
    const terms = await adminDb().db.execute<{ status: string }>(
      sql`SELECT status FROM rent_term WHERE id = ${TERM_ID}::uuid`,
    );
    expect([...terms][0]?.status).toBe("authorized");
  });

  it("refuses a command whose target moved since the authorization", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    const { command, entry } = await seedRentCommand({ expectedVersion: 1 });
    await adminDb().db.execute(
      sql`UPDATE rent_term SET version = version + 1 WHERE id = ${TERM_ID}::uuid`,
    );

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(outcome).toBe("rejected");
    expect(await readCommand(command.id)).toMatchObject({
      status: "rejected",
      errorType: "version_conflict",
    });
    expect(server.records("account.move")).toEqual([]);
  });

  it("lets an unchanged target through", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    const { entry } = await seedRentCommand({ expectedVersion: 1 });

    expect(await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry))).toBe(
      "confirmed",
    );
  });

  it("parks a lost response and reconciles it by operation reference", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    const boss = fakeBoss();
    const lostDeps: Deps = { ...deps, boss };
    const { command, entry } = await seedRentCommand();

    const port = lostDeps.odoo;
    if (!port) throw new Error("odoo port missing");
    // The create lands in Odoo, the answer never comes back.
    const timeoutDeps: Deps = {
      ...lostDeps,
      odoo: {
        ...port,
        operations: {
          ...port.operations,
          postRentInvoice: async () => {
            throw new AppError("RESULT_UNKNOWN", { message: "timeout" });
          },
        },
      },
    };
    expect(
      await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(timeoutDeps, entry)),
    ).toBe("unknown_result");
    expect((await readCommand(command.id)).status).toBe("unknown_result");

    // The move is in Odoo carrying the operation reference the SaaS chose.
    server.seed("account.move", [
      {
        id: 4242,
        move_type: "out_invoice",
        date: "2026-09-05",
        x_lfsci_ref: `lfsci:${command.id}`,
      },
    ]);

    const outcome = await reconcileOnce(lostDeps, {
      requestId: newId(),
      organizationId: ORG_ID,
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
      tries: 0,
    });

    expect(outcome).toMatchObject({ outcome: "confirmed", externalId: 4242 });
    expect((await readCommand(command.id)).status).toBe("confirmed");
  });

  it("writes the payment Odoo reconciled, once, and settles the term", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    const { entry } = await seedRentCommand();
    await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry));

    const move = server.records("account.move")[0];
    if (!move) throw new Error("no move");
    move.amount_residual = 0;
    move.payment_state = "paid";
    move.write_date = "2026-10-01 10:00:00";

    const first = await backsyncOrganization(deps, ORG_ID);
    expect(first.payments).toBe(1);

    const payments = await adminDb().db.execute<{ amount: string; status: string }>(
      sql`SELECT amount, status FROM payment`,
    );
    expect([...payments]).toHaveLength(1);
    expect([...payments][0]).toMatchObject({ amount: "780.00", status: "allocated" });

    const allocations = await adminDb().db.execute<{
      amount: string;
      confirmed_by_odoo: boolean;
    }>(
      sql`SELECT amount, confirmed_by_odoo FROM payment_allocation WHERE rent_term_id = ${TERM_ID}::uuid`,
    );
    expect([...allocations][0]).toMatchObject({ amount: "780.00", confirmed_by_odoo: true });

    const terms = await adminDb().db.execute<{ status: string }>(
      sql`SELECT status FROM rent_term WHERE id = ${TERM_ID}::uuid`,
    );
    expect([...terms][0]?.status).toBe("settled");

    // A second pass over the same page must not pay the term twice.
    await adminDb().db.execute(sql`DELETE FROM integration_cursor`);
    const second = await backsyncOrganization(deps, ORG_ID);
    expect(second.payments).toBe(0);
    const again = await adminDb().db.execute(sql`SELECT id FROM payment`);
    expect([...again]).toHaveLength(1);
  });

  it("opens an exception when Odoo carries another amount on a move we own", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    const { entry } = await seedRentCommand();
    await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry));

    const move = server.records("account.move")[0];
    if (!move) throw new Error("no move");
    move.amount_total = 900;
    move.amount_residual = 900;
    move.write_date = "2026-10-02 10:00:00";

    const outcome = await backsyncOrganization(deps, ORG_ID);
    expect(outcome.exceptions).toBe(1);

    const items = await adminDb().db.execute<{
      status: string;
      uncertainty_reason: string;
      source_reference: string;
    }>(sql`SELECT status, uncertainty_reason, source_reference FROM inbox_item`);
    expect([...items][0]).toMatchObject({
      status: "ambiguous",
      source_reference: `account.move:${move.id}:amount`,
    });
    expect([...items][0]?.uncertainty_reason).toContain("900.00");

    const events = await adminDb().db.execute<{ type: string }>(
      sql`SELECT type FROM event WHERE type = 'odoo_divergence'`,
    );
    expect([...events]).toHaveLength(1);

    // The same divergence read twice stays one exception.
    await adminDb().db.execute(sql`DELETE FROM integration_cursor`);
    expect((await backsyncOrganization(deps, ORG_ID)).exceptions).toBe(0);
    expect([...(await adminDb().db.execute(sql`SELECT id FROM inbox_item`))]).toHaveLength(1);
  });
  it("bills each captured expense line with its own analytic split", async () => {
    const server = createFakeOdoo();
    server.seed("res.partner", [{ name: "Fournisseur test", ref: SUPPLIER_REFERENCE }]);
    const deps = odooDeps(server);
    await seedExpenseDetail();
    const { entry } = await seedCommand("post_supplier_bill", {
      expenseId: EXPENSE_ID,
      supplierId: newId(),
      supplierReference: SUPPLIER_REFERENCE,
      issuedOn: "2026-09-01",
      totalExclTax: "100.00",
      taxAmount: "20.00",
      totalInclTax: "120.00",
      currency: "EUR",
      isNewSupplier: false,
      paymentIdentityChanged: false,
    });

    expect(await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry))).toBe(
      "confirmed",
    );

    const bill = server.records("account.move")[0];
    const lines = bill?.invoice_line_ids as [number, number, Record<string, unknown>][];
    const analytic = server.records("account.analytic.account");
    const idOf = (code: string) => String(analytic.find((row) => row.code === code)?.id);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.[2]).toMatchObject({
      name: "Entretien chaudière",
      price_unit: 80,
      analytic_distribution: { [idOf("LOT-A1")]: 75, [idOf("LOT-B2")]: 25 },
    });
    expect(lines[1]?.[2]).toMatchObject({
      name: "Déplacement",
      price_unit: 20,
      analytic_distribution: { [idOf("LOT-A1")]: 100 },
    });

    const expenses = await adminDb().db.execute<{ status: string; odoo_move_id: number }>(
      sql`SELECT status, odoo_move_id FROM expense WHERE id = ${EXPENSE_ID}::uuid`,
    );
    expect([...expenses][0]).toMatchObject({ status: "posted", odoo_move_id: bill?.id });
  });

  it("posts a partner current account movement and marks it posted", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    await seedCca();
    const { entry } = await seedCommand("record_cca_movement", {
      ccaId: CCA_ID,
      ccaMovementId: MOVEMENT_ID,
      kind: "contribution",
      amount: "1500.00",
      currency: "EUR",
      occurredOn: "2026-09-10",
      expenseId: null,
      justification: "Apport en compte courant",
    });

    expect(await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry))).toBe(
      "confirmed",
    );

    const move = server.records("account.move")[0];
    const lines = move?.line_ids as [number, number, Record<string, unknown>][];
    expect(lines[0]?.[2]).toMatchObject({ account_id: 300, credit: 1500, debit: 0 });
    expect(lines[1]?.[2]).toMatchObject({ account_id: 330, debit: 1500, credit: 0 });

    const movements = await adminDb().db.execute<{ status: string; odoo_move_id: number }>(
      sql`SELECT status, odoo_move_id FROM cca_movement WHERE id = ${MOVEMENT_ID}::uuid`,
    );
    expect([...movements][0]).toMatchObject({ status: "posted", odoo_move_id: move?.id });
  });
  it("refuses a receipt whose term has no Odoo entry, before fetching the file", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    await seedReceipt();
    const { command, entry } = await seedCommand("issue_receipt", {
      leaseId: LEASE_ID,
      kind: "quittance",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      rentAmount: "700.00",
      chargeAmount: "80.00",
      totalAmount: "780.00",
      currency: "EUR",
      issuedOn: "2026-10-01",
    });

    expect(await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry))).toBe(
      "rejected",
    );
    expect((await readCommand(command.id)).status).toBe("rejected");
    expect(server.records("ir.attachment")).toEqual([]);
  });

  it("attaches the rendered receipt to the move posted for the term", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    const { entry: rentEntry } = await seedRentCommand();
    await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, rentEntry));
    await seedReceipt();

    const pdf = Buffer.from("%PDF-1.4 quittance");
    const storage = {
      presignDownload: async () => "https://storage.test/quittance.pdf",
    } as unknown as NonNullable<Deps["storage"]>;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(pdf)) as typeof globalThis.fetch;

    try {
      const { entry } = await seedCommand("issue_receipt", {
        leaseId: LEASE_ID,
        kind: "quittance",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        rentAmount: "700.00",
        chargeAmount: "80.00",
        totalAmount: "780.00",
        currency: "EUR",
        issuedOn: "2026-10-01",
      });
      expect(
        await runWithCorrelation({ requestId: newId() }, () =>
          dispatchEntry({ ...deps, storage }, entry),
        ),
      ).toBe("confirmed");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const move = server.records("account.move")[0];
    const attachment = server.records("ir.attachment")[0];
    expect(attachment).toMatchObject({
      res_model: "account.move",
      res_id: move?.id,
      mimetype: "application/pdf",
    });
    expect(attachment?.datas).toBe(pdf.toString("base64"));
  });
  it("applies an approved rent revision to the terms from its effective date", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    await seedRevision();
    const { command, entry } = await seedCommand("revise_rent", revisionPayload());

    expect(await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry))).toBe(
      "confirmed",
    );
    expect((await readCommand(command.id)).status).toBe("confirmed");
    // The new rent reaches Odoo with the term that carries it, not with the revision.
    expect(server.records("account.move")).toEqual([]);

    const revisions = await adminDb().db.execute<{ status: string }>(
      sql`SELECT status FROM rent_revision WHERE id = ${REVISION_ID}::uuid`,
    );
    expect([...revisions][0]?.status).toBe("applied");

    expect(await termVersions(NEXT_TERM_ID)).toEqual([
      expect.objectContaining({ sequence: 1, reason: "initial", is_current: false }),
      expect.objectContaining({
        sequence: 2,
        reason: "revision",
        rent_amount: "718.61",
        total_amount: "798.61",
        is_current: true,
      }),
    ]);

    // The September term starts before the effective date and keeps its amounts.
    expect(await termVersions(TERM_ID)).toHaveLength(1);
  });

  it("changes nothing when the same revision is applied a second time", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    await seedRevision();

    const first = await seedCommand("revise_rent", revisionPayload());
    expect(
      await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, first.entry)),
    ).toBe("confirmed");
    const after = await termVersions(NEXT_TERM_ID);

    const second = await seedCommand("revise_rent", revisionPayload());
    expect(
      await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, second.entry)),
    ).toBe("confirmed");

    expect(await termVersions(NEXT_TERM_ID)).toEqual(after);
  });

  it("cancels the stale prepared command and re-prepares it on the new amounts", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    await seedRevision();
    const stale = await seedTermCommand(NEXT_TERM_ID, "prepared");
    const { entry } = await seedCommand("revise_rent", revisionPayload());

    expect(await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry))).toBe(
      "confirmed",
    );

    const commands = await commandsForTerm(NEXT_TERM_ID);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      id: stale.id,
      status: "cancelled",
      error_type: "version_conflict",
      rent_amount: "700.00",
      outbox_status: "cancelled",
    });
    expect(commands[1]).toMatchObject({
      status: "prepared",
      rent_amount: "718.61",
      outbox_status: "pending",
    });

    const replacement = await adminDb().db.execute<{ total: string; available_at: string }>(sql`
      SELECT c.payload ->> 'totalAmount' AS total, o.available_at::text AS available_at
        FROM command c JOIN outbox_entry o ON o.command_id = c.id
       WHERE c.id = ${commands[1]?.id}::uuid
    `);
    expect([...replacement][0]?.total).toBe("798.61");
    // Not runnable until a human authorizes it.
    expect([...replacement][0]?.available_at.startsWith("2999")).toBe(true);
  });

  it("leaves a command already sent to Odoo untouched", async () => {
    const server = createFakeOdoo();
    const deps = odooDeps(server);
    await seedRevision();
    const done = await seedTermCommand(NEXT_TERM_ID, "confirmed");
    const { entry } = await seedCommand("revise_rent", revisionPayload());

    expect(await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry))).toBe(
      "confirmed",
    );

    const commands = await commandsForTerm(NEXT_TERM_ID);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      id: done.id,
      status: "confirmed",
      version: done.version,
      rent_amount: "700.00",
    });
  });

  it("copies the ledger's journal balance onto the bank account, dated by its last mirrored line", async () => {
    const server = createFakeOdoo();
    server.seed("account.journal", [
      { id: 14, code: "BNK2", name: "Livret", type: "bank", current_statement_balance: 1310.55 },
    ]);
    const deps = odooDeps(server);
    const ACCOUNT_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
    await adminDb().db.execute(sql`
      INSERT INTO bank_account (id, organization_id, legal_entity_id, label, purpose, currency,
                                opening_balance, odoo_journal_id)
      VALUES (${ACCOUNT_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'Courant', 'operating',
              'EUR', 1000.00, 14)`);
    await adminDb().db.execute(sql`
      INSERT INTO bank_transaction (organization_id, bank_account_id, booked_on, amount, currency,
                                    odoo_statement_line_id, source_fingerprint)
      VALUES (${ORG_ID}::uuid, ${ACCOUNT_ID}::uuid, '2026-09-03', 310.55, 'EUR', 501, 'fp-501')`);

    const written = await runWithCorrelation({ requestId: newId() }, () =>
      mirrorJournalBalances(deps, ORG_ID),
    );

    expect(written).toBe(1);
    const rows = await adminDb().db.execute<{
      balance: string;
      on: string;
      read: string | null;
    }>(sql`
      SELECT odoo_balance::text AS balance, odoo_balance_on::text AS "on", odoo_read_at::text AS read
        FROM bank_account WHERE id = ${ACCOUNT_ID}::uuid`);
    expect([...rows][0]).toMatchObject({ balance: "1310.55", on: "2026-09-03" });
    expect([...rows][0]?.read).not.toBeNull();
  });

  it("leaves the account alone when the journal answers no balance", async () => {
    const server = createFakeOdoo();
    server.seed("account.journal", [
      { id: 14, code: "BNK2", name: "Livret", type: "bank", current_statement_balance: false },
    ]);
    const deps = odooDeps(server);
    await adminDb().db.execute(sql`
      INSERT INTO bank_account (organization_id, legal_entity_id, label, purpose, currency,
                                opening_balance, odoo_journal_id)
      VALUES (${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'Courant', 'operating', 'EUR', 1000.00, 14)`);

    expect(
      await runWithCorrelation({ requestId: newId() }, () => mirrorJournalBalances(deps, ORG_ID)),
    ).toBe(0);
    const rows = await adminDb().db.execute<{ balance: string | null }>(
      sql`SELECT odoo_balance::text AS balance FROM bank_account`,
    );
    expect([...rows][0]?.balance).toBeNull();
  });
});
