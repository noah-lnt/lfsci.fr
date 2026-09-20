import { currentCorrelation } from "@lfsci/kernel";
import { asc, eq, sql } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "./canonical";
import type { Tx } from "./client";
import { auditLog } from "./generated/schema";

/**
 * FROZEN field set covered by `hash`, in this order. Adding, removing or
 * reordering an entry invalidates every hash already stored: the chain of all
 * existing rows would no longer verify and SEC-03 evidence would be lost.
 * A new audit attribute goes into `before_value`/`after_value`, never a column.
 */
export const AUDIT_HASHED_FIELDS = [
  "organizationId",
  "sequence",
  "occurredAt",
  "actorKind",
  "actorUserId",
  "actorLabel",
  "objectTable",
  "objectId",
  "objectRefId",
  "action",
  "reason",
  "source",
  "beforeValue",
  "afterValue",
  "approvalId",
  "correlationId",
  "result",
] as const;

export type AuditHashedField = (typeof AUDIT_HASHED_FIELDS)[number];
export type AuditHashInput = Record<AuditHashedField, unknown>;

export type AuditEntry = {
  organizationId: string;
  actorKind: "user" | "technical" | "system" | "connector";
  objectTable: string;
  action: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  objectId?: string | null;
  objectRefId?: string | null;
  reason?: string | null;
  source?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  approvalId?: string | null;
  correlationId?: string | null;
  result?: "success" | "failure" | "refused" | "partial";
  occurredAt?: string;
};

export type AuditRow = typeof auditLog.$inferSelect;

/** Postgres renders timestamptz as "2026-09-20 06:30:00.123+00"; the hash must
 * not depend on which side of the round trip the value came from. */
function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function auditHash(previousHash: string | null, fields: AuditHashInput): string {
  const ordered: Record<string, unknown> = {};
  for (const key of AUDIT_HASHED_FIELDS) {
    ordered[key] = key === "occurredAt" ? instant(fields[key]) : (fields[key] ?? null);
  }
  return sha256Hex(`${previousHash ?? ""}\n${canonicalJson(ordered)}`);
}

export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<AuditRow> {
  // Serialises appends per organization: SELECT … FOR UPDATE is impossible here
  // because the app role deliberately has no UPDATE grant on audit_log.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('lfsci.audit_log'), hashtext(${entry.organizationId}))`,
  );

  const previous = await tx
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .where(eq(auditLog.organizationId, entry.organizationId))
    .orderBy(sql`sequence DESC`)
    .limit(1);
  const previousHash = previous[0]?.hash ?? null;

  const nextSequence = await tx.execute<{ sequence: string }>(
    sql`SELECT nextval(pg_get_serial_sequence('audit_log', 'sequence'))::text AS sequence`,
  );
  const sequence = Number([...nextSequence][0]?.sequence);

  const occurredAt = entry.occurredAt ?? new Date().toISOString();
  const correlationId = entry.correlationId ?? currentCorrelation()?.requestId ?? null;
  const fields: AuditHashInput = {
    organizationId: entry.organizationId,
    sequence,
    occurredAt,
    actorKind: entry.actorKind,
    actorUserId: entry.actorUserId ?? null,
    actorLabel: entry.actorLabel ?? null,
    objectTable: entry.objectTable,
    objectId: entry.objectId ?? null,
    objectRefId: entry.objectRefId ?? null,
    action: entry.action,
    reason: entry.reason ?? null,
    source: entry.source ?? null,
    beforeValue: entry.beforeValue ?? null,
    afterValue: entry.afterValue ?? null,
    approvalId: entry.approvalId ?? null,
    correlationId,
    result: entry.result ?? "success",
  };

  const rows = await tx
    .insert(auditLog)
    .values({
      organizationId: entry.organizationId,
      sequence,
      occurredAt,
      actorKind: entry.actorKind,
      actorUserId: entry.actorUserId ?? null,
      actorLabel: entry.actorLabel ?? null,
      objectTable: entry.objectTable,
      objectId: entry.objectId ?? null,
      objectRefId: entry.objectRefId ?? null,
      action: entry.action,
      reason: entry.reason ?? null,
      source: entry.source ?? null,
      beforeValue: entry.beforeValue ?? null,
      afterValue: entry.afterValue ?? null,
      approvalId: entry.approvalId ?? null,
      correlationId,
      result: entry.result ?? "success",
      previousHash,
      hash: auditHash(previousHash, fields),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("audit_log insert returned no row");
  return row;
}

export type AuditChainBreak = {
  id: string;
  sequence: number;
  reason: "previous_hash_mismatch" | "hash_mismatch";
  expected: string;
  stored: string | null;
};

/** Walks the organization's chain in sequence order; null means intact. */
export async function verifyAuditChain(
  tx: Tx,
  organizationId: string,
): Promise<AuditChainBreak | null> {
  const rows = await tx
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId))
    .orderBy(asc(auditLog.sequence));

  let previousHash: string | null = null;
  for (const row of rows) {
    const sequence = row.sequence ?? 0;
    if ((row.previousHash ?? null) !== previousHash) {
      return {
        id: row.id,
        sequence,
        reason: "previous_hash_mismatch",
        expected: previousHash ?? "",
        stored: row.previousHash,
      };
    }
    const expected = auditHash(previousHash, {
      organizationId: row.organizationId,
      sequence,
      occurredAt: row.occurredAt,
      actorKind: row.actorKind,
      actorUserId: row.actorUserId,
      actorLabel: row.actorLabel,
      objectTable: row.objectTable,
      objectId: row.objectId,
      objectRefId: row.objectRefId,
      action: row.action,
      reason: row.reason,
      source: row.source,
      beforeValue: row.beforeValue,
      afterValue: row.afterValue,
      approvalId: row.approvalId,
      correlationId: row.correlationId,
      result: row.result,
    });
    if (expected !== row.hash) {
      return { id: row.id, sequence, reason: "hash_mismatch", expected, stored: row.hash };
    }
    previousHash = row.hash;
  }
  return null;
}
