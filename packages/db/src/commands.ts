import { AppError, currentCorrelation } from "@lfsci/kernel";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { hashPayload } from "./canonical";
import type { Tx } from "./client";
import { approval, command, commandAttempt, outboxEntry } from "./generated/schema";

export type CommandRow = typeof command.$inferSelect;
export type ApprovalRow = typeof approval.$inferSelect;
export type OutboxRow = typeof outboxEntry.$inferSelect;
export type CommandAttemptRow = typeof commandAttempt.$inferSelect;

export type CommandStatus = CommandRow["status"];

export type CommandEnvelope = {
  organizationId: string;
  commandType: string;
  operationKey: string;
  payload: unknown;
  payloadHash?: string;
  targetObjectRefId?: string | null;
  expectedVersion?: number | null;
  ruleVersionId?: string | null;
  actorUserId?: string | null;
  authorizationScope?: Record<string, unknown>;
  autonomyLevel?: "A" | "B" | "C" | "D";
  status?: CommandStatus;
  correlationId?: string;
};

/**
 * ARC-02: (organization_id, operation_key) is the idempotency key and is bound
 * to the payload hash. Same key + same payload returns the stored command;
 * same key + different payload is a client bug, never a second execution.
 */
export async function createCommand(tx: Tx, envelope: CommandEnvelope): Promise<CommandRow> {
  const payloadHash = envelope.payloadHash ?? hashPayload(envelope.payload);
  const existing = await findCommandByOperationKey(
    tx,
    envelope.organizationId,
    envelope.operationKey,
  );
  if (existing) return sameOrConflict(existing, payloadHash);

  const values: typeof command.$inferInsert = {
    organizationId: envelope.organizationId,
    commandType: envelope.commandType,
    operationKey: envelope.operationKey,
    payload: envelope.payload,
    payloadHash,
    targetObjectRefId: envelope.targetObjectRefId ?? null,
    expectedVersion: envelope.expectedVersion ?? null,
    ruleVersionId: envelope.ruleVersionId ?? null,
    actorUserId: envelope.actorUserId ?? null,
    authorizationScope: envelope.authorizationScope ?? {},
    autonomyLevel: envelope.autonomyLevel ?? "D",
    status: envelope.status ?? "prepared",
    ...((envelope.correlationId ?? currentCorrelation()?.requestId)
      ? { correlationId: (envelope.correlationId ?? currentCorrelation()?.requestId) as string }
      : {}),
  };

  const inserted = await tx.insert(command).values(values).onConflictDoNothing().returning();
  const row = inserted[0];
  if (row) return row;

  const raced = await findCommandByOperationKey(tx, envelope.organizationId, envelope.operationKey);
  if (!raced) throw new AppError("CONFLICT", { message: "command could not be read back" });
  return sameOrConflict(raced, payloadHash);
}

function sameOrConflict(row: CommandRow, payloadHash: string): CommandRow {
  if (row.payloadHash === payloadHash) return row;
  throw new AppError("IDEMPOTENCY_KEY_REUSED", {
    details: {
      operationKey: row.operationKey,
      commandId: row.id,
      storedPayloadHash: row.payloadHash,
      submittedPayloadHash: payloadHash,
    },
  });
}

export async function findCommandByOperationKey(
  tx: Tx,
  organizationId: string,
  operationKey: string,
): Promise<CommandRow | undefined> {
  const rows = await tx
    .select()
    .from(command)
    .where(and(eq(command.organizationId, organizationId), eq(command.operationKey, operationKey)))
    .limit(1);
  return rows[0];
}

export type ApprovalInput = {
  organizationId: string;
  commandId: string;
  approvedPayloadHash: string;
  approverUserId: string;
  expiresAt: string;
  decision?: "approved" | "refused";
  refusalReason?: string;
  scope?: Record<string, unknown>;
  ruleVersionId?: string | null;
  evidenceObjectRefId?: string | null;
  approvedAt?: string;
};

export async function recordApproval(tx: Tx, input: ApprovalInput): Promise<ApprovalRow> {
  const decision = input.decision ?? "approved";
  const rows = await tx
    .insert(approval)
    .values({
      organizationId: input.organizationId,
      commandId: input.commandId,
      approvedPayloadHash: input.approvedPayloadHash,
      decision,
      refusalReason: input.refusalReason ?? null,
      scope: input.scope ?? {},
      ruleVersionId: input.ruleVersionId ?? null,
      approverUserId: input.approverUserId,
      expiresAt: input.expiresAt,
      evidenceObjectRefId: input.evidenceObjectRefId ?? null,
      ...(input.approvedAt ? { approvedAt: input.approvedAt } : {}),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new AppError("CONFLICT", { message: "approval insert returned no row" });
  return row;
}

/**
 * IA-03 / SYN-01: revalidated immediately before the external effect. A payload
 * that changed after the decision, an expired or a revoked approval are all
 * APPROVAL_INVALID — the caller must ask again, never proceed.
 */
export async function assertApprovalValid(
  tx: Tx,
  commandId: string,
  payloadHash: string,
  now: Date = new Date(),
): Promise<ApprovalRow> {
  const rows = await tx
    .select()
    .from(approval)
    .where(
      and(
        eq(approval.commandId, commandId),
        eq(approval.decision, "approved"),
        isNull(approval.revokedAt),
      ),
    )
    .orderBy(sql`approved_at DESC`)
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError("APPROVAL_INVALID", {
      details: { commandId, reason: "no_active_approval" },
    });
  }
  if (row.approvedPayloadHash !== payloadHash) {
    throw new AppError("APPROVAL_INVALID", {
      details: {
        commandId,
        reason: "payload_hash_mismatch",
        approvedPayloadHash: row.approvedPayloadHash,
        submittedPayloadHash: payloadHash,
      },
    });
  }
  if (new Date(row.expiresAt).getTime() <= now.getTime()) {
    throw new AppError("APPROVAL_INVALID", {
      details: { commandId, reason: "expired", expiresAt: row.expiresAt },
    });
  }
  return row;
}

export async function revokeApproval(
  tx: Tx,
  approvalId: string,
  reason: string,
): Promise<ApprovalRow | undefined> {
  const rows = await tx
    .update(approval)
    .set({ revokedAt: new Date().toISOString(), revokedReason: reason })
    .where(and(eq(approval.id, approvalId), isNull(approval.revokedAt)))
    .returning();
  return rows[0];
}

/** MOD-03: the lock is (status, version) in the database, not the UI state. */
export async function transitionCommand(
  tx: Tx,
  id: string,
  from: CommandStatus,
  to: CommandStatus,
  expectedVersion: number,
  patch: Partial<
    Pick<CommandRow, "errorType" | "errorDetail" | "externalRefId" | "approvalId">
  > = {},
): Promise<CommandRow> {
  const rows = await tx
    .update(command)
    .set({
      ...patch,
      status: to,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(command.id, id), eq(command.status, from), eq(command.version, expectedVersion)))
    .returning();
  const row = rows[0];
  if (row) return row;

  const current = await tx.select().from(command).where(eq(command.id, id)).limit(1);
  const actual = current[0];
  if (!actual) throw new AppError("NOT_FOUND", { details: { commandId: id } });
  throw new AppError("VERSION_CONFLICT", {
    details: {
      commandId: id,
      expectedStatus: from,
      expectedVersion,
      actualStatus: actual.status,
      actualVersion: actual.version,
    },
  });
}

export type OutboxInput = {
  organizationId: string;
  kind: OutboxRow["channel"];
  payload: unknown;
  commandId?: string | null;
  messageOutboundId?: string | null;
  partitionKey?: string;
  payloadHash?: string;
  availableAt?: string | Date;
  maxAttempts?: number;
};

export async function enqueueOutbox(tx: Tx, input: OutboxInput): Promise<OutboxRow> {
  const availableAt =
    input.availableAt instanceof Date ? input.availableAt.toISOString() : input.availableAt;
  const rows = await tx
    .insert(outboxEntry)
    .values({
      organizationId: input.organizationId,
      commandId: input.commandId ?? null,
      messageOutboundId: input.messageOutboundId ?? null,
      channel: input.kind,
      partitionKey: input.partitionKey ?? input.commandId ?? input.organizationId,
      payload: input.payload,
      payloadHash: input.payloadHash ?? hashPayload(input.payload),
      ...(availableAt ? { availableAt } : {}),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new AppError("CONFLICT", { message: "outbox insert returned no row" });
  return row;
}

export type ClaimOutboxInput = {
  limit: number;
  workerId: string;
  leaseSeconds: number;
  channels?: string[];
};

/**
 * FOR UPDATE SKIP LOCKED: two workers claiming at the same instant get disjoint
 * sets. Expired leases are reclaimable, and the generation token lets a handler
 * detect that an older worker lost the row (SYN-01).
 */
export async function claimOutbox(tx: Tx, input: ClaimOutboxInput): Promise<OutboxRow[]> {
  // The lock is taken in its own statement: an `IN (SELECT … FOR UPDATE SKIP
  // LOCKED LIMIT n)` subplan can be re-executed per outer row and then claims a
  // multiple of n. The locks hold for the rest of the transaction.
  const channelFilter = input.channels
    ? sql`AND channel IN (${sql.join(
        input.channels.map((channel) => sql`${channel}`),
        sql`, `,
      )})`
    : sql``;
  const locked = await tx.execute<{ id: string }>(sql`
    SELECT id
      FROM outbox_entry
     WHERE ((status = 'pending' AND available_at <= now())
        OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()))
       ${channelFilter}
     ORDER BY available_at, id
       FOR UPDATE SKIP LOCKED
     LIMIT ${input.limit}
  `);
  const ids = [...locked].map((row) => row.id);
  if (ids.length === 0) return [];

  return tx
    .update(outboxEntry)
    .set({
      status: "leased",
      leaseOwner: input.workerId,
      leaseExpiresAt: sql`now() + make_interval(secs => ${input.leaseSeconds}::double precision)`,
      leaseGeneration: sql`${outboxEntry.leaseGeneration} + 1`,
      attempts: sql`${outboxEntry.attempts} + 1`,
      version: sql`${outboxEntry.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(inArray(outboxEntry.id, ids))
    .returning();
}

export async function completeOutbox(
  tx: Tx,
  id: string,
  status: "sent" | "confirmed" = "confirmed",
): Promise<OutboxRow | undefined> {
  const rows = await tx
    .update(outboxEntry)
    .set({
      status,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(outboxEntry.id, id))
    .returning();
  return rows[0];
}

export type FailOutboxInput = { error: string; retryInSeconds?: number };

/** A row that has burned its attempts goes to dead_letter instead of looping. */
export async function failOutbox(
  tx: Tx,
  id: string,
  input: FailOutboxInput,
): Promise<OutboxRow | undefined> {
  const retryInSeconds = input.retryInSeconds ?? 60;
  const exhausted = sql`${outboxEntry.attempts} >= ${outboxEntry.maxAttempts}`;
  const rows = await tx
    .update(outboxEntry)
    .set({
      status: sql`CASE WHEN ${exhausted} THEN 'dead_letter' ELSE 'pending' END`,
      availableAt: sql`CASE WHEN ${exhausted} THEN ${outboxEntry.availableAt} ELSE now() + make_interval(secs => ${retryInSeconds}::double precision) END`,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: input.error,
      version: sql`${outboxEntry.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(outboxEntry.id, id))
    .returning();
  return rows[0];
}

export type CommandAttemptInput = {
  organizationId: string;
  commandId: string;
  step: string;
  attemptNumber?: number;
  outcome?: CommandAttemptRow["outcome"];
  httpStatus?: number | null;
  providerFault?: string | null;
  responseExcerpt?: string | null;
  workerId?: string | null;
  lockGeneration?: number | null;
  finishedAt?: string | null;
};

export async function recordCommandAttempt(
  tx: Tx,
  input: CommandAttemptInput,
): Promise<CommandAttemptRow> {
  const attemptNumber = input.attemptNumber ?? (await nextAttemptNumber(tx, input.commandId));
  const rows = await tx
    .insert(commandAttempt)
    .values({
      organizationId: input.organizationId,
      commandId: input.commandId,
      attemptNumber,
      step: input.step,
      outcome: input.outcome ?? "running",
      httpStatus: input.httpStatus ?? null,
      providerFault: input.providerFault ?? null,
      responseExcerpt: input.responseExcerpt ?? null,
      workerId: input.workerId ?? null,
      lockGeneration: input.lockGeneration ?? null,
      finishedAt: input.finishedAt ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new AppError("CONFLICT", { message: "command_attempt insert returned no row" });
  return row;
}

export async function finishCommandAttempt(
  tx: Tx,
  id: string,
  outcome: CommandAttemptRow["outcome"],
  patch: Partial<Pick<CommandAttemptRow, "httpStatus" | "providerFault" | "responseExcerpt">> = {},
): Promise<CommandAttemptRow | undefined> {
  const rows = await tx
    .update(commandAttempt)
    .set({ ...patch, outcome, finishedAt: new Date().toISOString() })
    .where(eq(commandAttempt.id, id))
    .returning();
  return rows[0];
}

async function nextAttemptNumber(tx: Tx, commandId: string): Promise<number> {
  const rows = await tx.execute<{ next: number }>(
    sql`SELECT COALESCE(max(attempt_number), 0) + 1 AS next FROM command_attempt WHERE command_id = ${commandId}`,
  );
  return Number([...rows][0]?.next ?? 1);
}
