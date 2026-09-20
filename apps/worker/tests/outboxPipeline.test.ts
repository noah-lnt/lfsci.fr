import type { CommandRow, OutboxRow } from "@lfsci/db";
import {
  claimOutbox,
  createCommand,
  enqueueOutbox,
  recordApproval,
  transitionCommand,
  withoutTenant,
  withTenant,
} from "@lfsci/db";
import { AppError, newId, runWithCorrelation } from "@lfsci/kernel";
import { createOdooClient, createOdooOperations } from "@lfsci/odoo";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../src/deps";
import { dispatchEntry, dispatchOnce, odooBreaker } from "../src/jobs/outboxDispatch";
import { reconcileOnce } from "../src/jobs/outboxReconcile";
import { reapOrphanedLeases } from "../src/ops";
import {
  adminDb,
  appDb,
  closeDbs,
  EXPENSE_ID,
  migrate,
  ORG_ID,
  SUPPLIER_REFERENCE,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
  USER_ID,
} from "./db";
import { fakeBoss, fakeDeps, fakeOdooPort } from "./fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

function payload() {
  return {
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
  };
}

async function seedAuthorizedCommand(options: { withApproval?: boolean } = {}): Promise<{
  command: CommandRow;
  entry: OutboxRow;
}> {
  return withTenant(appDb(), { organizationId: ORG_ID }, async (tx) => {
    const prepared = await createCommand(tx, {
      organizationId: ORG_ID,
      commandType: "post_supplier_bill",
      operationKey: `post_supplier_bill:${newId()}`,
      payload: payload(),
      autonomyLevel: "C",
      status: "prepared",
    });
    let approvalId: string | undefined;
    if (options.withApproval) {
      const approval = await recordApproval(tx, {
        organizationId: ORG_ID,
        commandId: prepared.id,
        approvedPayloadHash: prepared.payloadHash,
        approverUserId: USER_ID,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      approvalId = approval.id;
    }
    const command = await transitionCommand(
      tx,
      prepared.id,
      "prepared",
      "authorized",
      prepared.version,
      approvalId ? { approvalId } : {},
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

type CommandSnapshot = Pick<
  CommandRow,
  "id" | "status" | "errorType" | "externalRefId" | "version"
>;

/** `db.execute` returns the raw column names, so the snapshot aliases them. */
async function readCommand(id: string): Promise<CommandSnapshot> {
  const rows = await adminDb().db.execute<CommandSnapshot>(sql`
    SELECT id, status, error_type AS "errorType",
           external_ref_id AS "externalRefId", version
      FROM command WHERE id = ${id}::uuid
  `);
  const row = [...rows][0];
  if (!row) throw new Error("command not found");
  return row;
}

async function readOutbox(id: string): Promise<{ status: string; attempts: number }> {
  const rows = await adminDb().db.execute<{ status: string; attempts: number }>(
    sql`SELECT status, attempts FROM outbox_entry WHERE id = ${id}::uuid`,
  );
  const row = [...rows][0];
  if (!row) throw new Error("outbox entry not found");
  return row;
}

async function claimOne(deps: Deps): Promise<OutboxRow> {
  const claimed = await withoutTenant(adminDb(), (tx) =>
    claimOutbox(tx, { limit: 1, workerId: deps.workerId, leaseSeconds: 300 }),
  );
  const row = claimed[0];
  if (!row) throw new Error("no pending outbox entry");
  return row;
}

function depsWith(operations: Parameters<typeof fakeOdooPort>[0]): Deps {
  return fakeDeps({
    db: appDb(),
    admin: adminDb(),
    boss: fakeBoss(),
    odoo: fakeOdooPort(operations),
    now: () => new Date(),
  });
}

const partner = { id: 7, name: "Fournisseur test" };

run("outbox dispatch against the real database", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
    odooBreaker.recordSuccess();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("confirms the command, maps the external ref and clears the outbox entry", async () => {
    const { command, entry } = await seedAuthorizedCommand();
    const deps = depsWith({
      findPartnerByRef: async (ref: string) => {
        expect(ref).toBe(SUPPLIER_REFERENCE);
        return partner;
      },
      createDraftSupplierBill: async (input: { operationRef?: string }) => ({
        id: 4242,
        operationRef: input.operationRef ?? "",
      }),
    });

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(outcome).toBe("confirmed");
    const after = await readCommand(command.id);
    expect(after.status).toBe("confirmed");
    expect(after.externalRefId).not.toBeNull();
    expect((await readOutbox(entry.id)).status).toBe("confirmed");

    const refs = await adminDb().db.execute<{ external_id: string; model: string }>(
      sql`SELECT external_id, model FROM external_ref WHERE internal_id = ${EXPENSE_ID}::uuid`,
    );
    expect([...refs][0]).toMatchObject({ external_id: "4242", model: "account.move" });

    const attempts = await adminDb().db.execute<{ outcome: string }>(
      sql`SELECT outcome FROM command_attempt WHERE command_id = ${command.id}::uuid`,
    );
    expect([...attempts].map((a) => a.outcome)).toEqual(["success"]);
  });

  it("parks a RESULT_UNKNOWN in unknown_result and schedules a reconcile, never a retry", async () => {
    const { command, entry } = await seedAuthorizedCommand();
    const boss = fakeBoss();
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss,
      odoo: fakeOdooPort({
        findPartnerByRef: async () => partner,
        createDraftSupplierBill: async () => {
          throw new AppError("RESULT_UNKNOWN", { message: "timeout" });
        },
      }),
      now: () => new Date(),
    });

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(outcome).toBe("unknown_result");
    expect((await readCommand(command.id)).status).toBe("unknown_result");
    expect((await readCommand(command.id)).errorType).toBe("unknown_result");
    expect((await readOutbox(entry.id)).status).toBe("sent");
    expect(boss.sent).toHaveLength(1);
    expect(boss.sent[0]?.queue).toBe("outbox.reconcile");
    expect(boss.sent[0]?.data).toMatchObject({
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
    });
  });

  it("makes PERIOD_LOCKED terminal and leaves the breaker closed", async () => {
    const { command, entry } = await seedAuthorizedCommand();
    const deps = depsWith({
      findPartnerByRef: async () => partner,
      createDraftSupplierBill: async () => {
        throw new AppError("PERIOD_LOCKED", { message: "lock date" });
      },
    });

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(outcome).toBe("rejected");
    const after = await readCommand(command.id);
    expect(after.status).toBe("rejected");
    expect(after.errorType).toBe("closed_period");
    expect((await readOutbox(entry.id)).status).toBe("dead_letter");
    expect(odooBreaker.state(Date.now())).toBe("closed");
    expect(odooBreaker.consecutiveFailures()).toBe(0);
  });

  it("returns a real transport failure to authorized for a retry and counts it on the breaker", async () => {
    const { command, entry } = await seedAuthorizedCommand();
    // A genuine transport failure: the real client maps a rejected fetch and
    // marks the error, which is what `isTransportError` reads.
    const client = createOdooClient({
      baseUrl: "https://odoo.test",
      apiKey: "k",
      fetch: async () => {
        throw new Error("ECONNRESET");
      },
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
    });
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss: fakeBoss(),
      odoo: {
        client,
        operations: createOdooOperations(client),
        database: "lfsci-test",
        timeoutMs: 30_000,
      },
      now: () => new Date(),
    });

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(outcome).toBe("retry");
    const after = await readCommand(command.id);
    expect(after.status).toBe("authorized");
    expect(after.errorType).toBe("provider_unavailable");
    expect((await readOutbox(entry.id)).status).toBe("pending");
    expect(odooBreaker.consecutiveFailures()).toBe(1);
    odooBreaker.recordSuccess();
  });

  it("refuses to send when the approval has expired", async () => {
    const { command, entry } = await seedAuthorizedCommand({ withApproval: true });
    // `expires_at > approved_at` is a table constraint: both move back together.
    await adminDb().db.execute(sql`
      UPDATE approval
         SET approved_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
       WHERE command_id = ${command.id}::uuid
    `);
    let called = false;
    const deps = depsWith({
      findPartnerByRef: async () => {
        called = true;
        return partner;
      },
      createDraftSupplierBill: async () => ({ id: 1, operationRef: "" }),
    });

    const outcome = await runWithCorrelation({ requestId: newId() }, () =>
      dispatchEntry(deps, entry),
    );

    expect(called).toBe(false);
    expect(outcome).toBe("rejected");
    const after = await readCommand(command.id);
    expect(after.status).toBe("rejected");
    expect(after.errorType).toBe("permission");
  });

  it("gives an entry on another channel back untouched, attempt included", async () => {
    const entry = await withTenant(appDb(), { organizationId: ORG_ID }, (tx) =>
      enqueueOutbox(tx, {
        organizationId: ORG_ID,
        kind: "email",
        payload: { to: "locataire@exemple.test" },
      }),
    );
    const deps = depsWith({});
    const claimed = await claimOne(deps);
    expect((await readOutbox(entry.id)).attempts).toBe(1);

    expect(await dispatchEntry(deps, claimed)).toBe("released");
    const after = await readOutbox(entry.id);
    expect(after.status).toBe("pending");
    expect(after.attempts).toBe(0);
  });

  it("skips every claim while the breaker is open", async () => {
    const { entry } = await seedAuthorizedCommand();
    const deps = depsWith({});
    for (let i = 0; i < 5; i += 1) odooBreaker.recordTransportFailure(Date.now());
    expect(odooBreaker.state(Date.now())).toBe("open");

    expect(await dispatchEntry(deps, entry)).toBe("skipped");
    expect((await readOutbox(entry.id)).status).toBe("pending");
    odooBreaker.recordSuccess();
  });

  it("dispatchOnce claims nothing when the queue is empty", async () => {
    const deps = depsWith({});
    expect(await dispatchOnce(deps, 10)).toEqual({ outcome: "idle", claimed: 0 });
  });

  it("returns an orphaned lease to pending at boot", async () => {
    const { entry } = await seedAuthorizedCommand();
    await adminDb().db.execute(sql`
      UPDATE outbox_entry
         SET status = 'leased', lease_owner = 'dead-worker',
             lease_expires_at = now() - interval '1 hour'
       WHERE id = ${entry.id}::uuid
    `);
    expect(await reapOrphanedLeases(adminDb())).toBe(1);
    expect((await readOutbox(entry.id)).status).toBe("pending");
  });
});

run("outbox reconcile against the real database", () => {
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

  async function seedUnknown(): Promise<CommandSnapshot> {
    const { command, entry } = await seedAuthorizedCommand();
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss: fakeBoss(),
      odoo: fakeOdooPort({
        findPartnerByRef: async () => partner,
        createDraftSupplierBill: async () => {
          throw new AppError("RESULT_UNKNOWN", { message: "timeout" });
        },
      }),
      now: () => new Date(),
    });
    await runWithCorrelation({ requestId: newId() }, () => dispatchEntry(deps, entry));
    return readCommand(command.id);
  }

  it("confirms on a single match and maps the external ref", async () => {
    const command = await seedUnknown();
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss: fakeBoss(),
      odoo: fakeOdooPort({
        findByOperationRef: async () => ({ kind: "one", model: "account.move", id: 909 }),
      }),
      now: () => new Date(),
    });

    const result = await reconcileOnce(deps, {
      requestId: newId(),
      organizationId: ORG_ID,
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
      tries: 0,
    });

    expect(result).toMatchObject({ outcome: "confirmed", externalId: 909 });
    expect((await readCommand(command.id)).status).toBe("confirmed");
  });

  it("opens a conflict on several matches", async () => {
    const command = await seedUnknown();
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss: fakeBoss(),
      odoo: fakeOdooPort({
        findByOperationRef: async () => ({
          kind: "many",
          matches: [
            { model: "account.move", id: 1 },
            { model: "account.move", id: 2 },
          ],
        }),
      }),
      now: () => new Date(),
    });

    const result = await reconcileOnce(deps, {
      requestId: newId(),
      organizationId: ORG_ID,
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
      tries: 0,
    });

    expect(result).toMatchObject({ outcome: "conflict", matches: 2 });
    const after = await readCommand(command.id);
    expect(after.status).toBe("conflict");
    expect(after.errorType).toBe("ambiguous_reference");
  });

  it("reschedules on an absence the client timeout cannot yet explain", async () => {
    const command = await seedUnknown();
    const boss = fakeBoss();
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss,
      odoo: fakeOdooPort({ findByOperationRef: async () => ({ kind: "none" }) }),
      now: () => new Date(),
    });

    const result = await reconcileOnce(deps, {
      requestId: newId(),
      organizationId: ORG_ID,
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
      tries: 0,
    });

    expect(result).toMatchObject({ outcome: "rescheduled", tries: 1 });
    expect(boss.sent[0]?.queue).toBe("outbox.reconcile");
    expect((await readCommand(command.id)).status).toBe("unknown_result");
  });

  it("allows one controlled retry once the call can no longer be executing", async () => {
    const command = await seedUnknown();
    const later = new Date(Date.now() + 30_000 + 120_000 + 5_000);
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss: fakeBoss(),
      odoo: fakeOdooPort({ findByOperationRef: async () => ({ kind: "none" }) }),
      now: () => later,
    });

    const result = await reconcileOnce(deps, {
      requestId: newId(),
      organizationId: ORG_ID,
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
      tries: 0,
    });

    expect(result.outcome).toBe("retry_allowed");
    expect((await readCommand(command.id)).status).toBe("authorized");
  });

  it("gives up as a conflict after the try budget", async () => {
    const command = await seedUnknown();
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss: fakeBoss(),
      odoo: fakeOdooPort({ findByOperationRef: async () => ({ kind: "none" }) }),
      now: () => new Date(),
    });

    const result = await reconcileOnce(deps, {
      requestId: newId(),
      organizationId: ORG_ID,
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
      tries: 5,
    });

    expect(result).toMatchObject({ outcome: "conflict", tries: 6 });
    expect((await readCommand(command.id)).status).toBe("conflict");
  });

  it("does nothing to a command that has already settled", async () => {
    const { command } = await seedAuthorizedCommand();
    const deps = fakeDeps({
      db: appDb(),
      admin: adminDb(),
      boss: fakeBoss(),
      odoo: fakeOdooPort({}),
      now: () => new Date(),
    });
    const result = await reconcileOnce(deps, {
      requestId: newId(),
      organizationId: ORG_ID,
      commandId: command.id,
      operationRef: `lfsci:${command.id}`,
      tries: 0,
    });
    expect(result).toEqual({ outcome: "already_settled", status: "authorized" });
  });
});
