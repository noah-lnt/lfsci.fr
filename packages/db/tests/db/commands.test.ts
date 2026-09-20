import { isAppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  assertApprovalValid,
  claimOutbox,
  completeOutbox,
  createCommand,
  enqueueOutbox,
  failOutbox,
  recordApproval,
  recordCommandAttempt,
  transitionCommand,
} from "../../src/commands";
import { withTenant } from "../../src/tenant";
import { adminDb, extraDb, seedTwoOrganizations, testDb } from "./helpers";

const envelope = (organizationId: string, payload: unknown) => ({
  organizationId,
  commandType: "post_rent_term",
  operationKey: "rent-term:2026-09:lease-1",
  payload,
});

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not-an-AppError: ${String(error)}`;
}

describe("commands", () => {
  it("returns the stored command when the same key carries the same payload", async () => {
    const { orgA } = await seedTwoOrganizations();
    const [first, second] = await withTenant(testDb(), { organizationId: orgA }, async (tx) => [
      await createCommand(tx, envelope(orgA, { amount: "680.00" })),
      await createCommand(tx, envelope(orgA, { amount: "680.00" })),
    ]);
    expect(second.id).toBe(first.id);
  });

  it("refuses the same key with a different payload", async () => {
    const { orgA } = await seedTwoOrganizations();
    const error = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      await createCommand(tx, envelope(orgA, { amount: "680.00" }));
      return createCommand(tx, envelope(orgA, { amount: "681.00" })).catch((e: unknown) => e);
    });
    expect(codeOf(error)).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("validates an approval against the payload hash and its expiry", async () => {
    const { orgA, userA } = await seedTwoOrganizations();
    const outcome = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const command = await createCommand(tx, envelope(orgA, { amount: "680.00" }));
      await recordApproval(tx, {
        organizationId: orgA,
        commandId: command.id,
        approvedPayloadHash: command.payloadHash,
        approverUserId: userA,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      return {
        valid: await assertApprovalValid(tx, command.id, command.payloadHash),
        mismatch: await assertApprovalValid(tx, command.id, "deadbeef").catch((e: unknown) => e),
        expired: await assertApprovalValid(
          tx,
          command.id,
          command.payloadHash,
          new Date(Date.now() + 120_000),
        ).catch((e: unknown) => e),
      };
    });

    expect(outcome.valid.decision).toBe("approved");
    expect(codeOf(outcome.mismatch)).toBe("APPROVAL_INVALID");
    expect(codeOf(outcome.expired)).toBe("APPROVAL_INVALID");
  });

  it("locks the transition on the expected version", async () => {
    const { orgA } = await seedTwoOrganizations();
    const outcome = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const command = await createCommand(tx, envelope(orgA, { amount: "680.00" }));
      const authorized = await transitionCommand(
        tx,
        command.id,
        "prepared",
        "authorized",
        command.version,
      );
      const stale = await transitionCommand(
        tx,
        command.id,
        "authorized",
        "sent",
        command.version,
      ).catch((e: unknown) => e);
      return { authorized, stale };
    });

    expect(outcome.authorized.status).toBe("authorized");
    expect(outcome.authorized.version).toBe(2);
    expect(codeOf(outcome.stale)).toBe("VERSION_CONFLICT");
  });

  it("records an attempt per step with an increasing number", async () => {
    const { orgA } = await seedTwoOrganizations();
    const numbers = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const command = await createCommand(tx, envelope(orgA, { amount: "680.00" }));
      const first = await recordCommandAttempt(tx, {
        organizationId: orgA,
        commandId: command.id,
        step: "draft",
        outcome: "success",
      });
      const second = await recordCommandAttempt(tx, {
        organizationId: orgA,
        commandId: command.id,
        step: "post",
        outcome: "running",
      });
      return [first.attemptNumber, second.attemptNumber];
    });
    expect(numbers).toEqual([1, 2]);
  });
});

describe("outbox", () => {
  async function fillOutbox(organizationId: string, count: number) {
    return withTenant(testDb(), { organizationId }, async (tx) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const entry = await enqueueOutbox(tx, {
          organizationId,
          kind: "odoo",
          payload: { index: i },
          partitionKey: `p-${i}`,
        });
        ids.push(entry.id);
      }
      return ids;
    });
  }

  it("gives each row to exactly one claimant", async () => {
    const { orgA } = await seedTwoOrganizations();
    await fillOutbox(orgA, 4);

    const workerOne = extraDb();
    const workerTwo = extraDb();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withTenant(workerOne, { organizationId: orgA }, async (tx) => {
      const rows = await claimOutbox(tx, { limit: 2, workerId: "w1", leaseSeconds: 60 });
      await gate;
      return rows;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await withTenant(workerTwo, { organizationId: orgA }, (tx) =>
      claimOutbox(tx, { limit: 2, workerId: "w2", leaseSeconds: 60 }),
    );
    release();
    const firstRows = await first;

    const a = firstRows.map((r) => r.id).sort();
    const b = second.map((r) => r.id).sort();
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    expect(firstRows.every((r) => r.attempts === 1)).toBe(true);
  });

  it("completes and dead-letters", async () => {
    const { orgA } = await seedTwoOrganizations();
    const ids = await fillOutbox(orgA, 2);
    const first = ids[0];
    const second = ids[1];
    if (!first || !second) throw new Error("missing outbox ids");

    const result = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      await claimOutbox(tx, { limit: 2, workerId: "w1", leaseSeconds: 60 });
      const done = await completeOutbox(tx, first, "confirmed");
      const retried = await failOutbox(tx, second, { error: "boom", retryInSeconds: 30 });
      await tx.execute(
        sql`UPDATE outbox_entry SET attempts = max_attempts WHERE id = ${second}::uuid`,
      );
      const dead = await failOutbox(tx, second, { error: "boom again" });
      return { done, retried, dead };
    });

    expect(result.done?.status).toBe("confirmed");
    expect(result.retried?.status).toBe("pending");
    expect(result.dead?.status).toBe("dead_letter");
    expect(result.dead?.lastError).toBe("boom again");

    const rows = await adminDb().db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM outbox_entry WHERE status = 'dead_letter'`,
    );
    expect([...rows][0]?.count).toBe("1");
  });
});
