import "server-only";
import type { ObjectKind, Tx } from "@lfsci/db";
import { ensureObjectRef, linkActivity, recordAudit } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { InboxDecision, InboxDecisionResult, InboxRow } from "@/lib/contracts/inbox";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { readRow, toRow } from "./queries";

export type DecideInput = {
  id: string;
  expectedVersion: number;
  decision: InboxDecision;
  attachTo?: { kind: string; id: string } | undefined;
  reason?: string | undefined;
};

/** INB-01: the hand-off carries the inbox item; the target form owns the write. */
const HANDOFF: Partial<Record<InboxDecision, (id: string) => string>> = {
  createExpense: (id) => `/finance/depenses/nouvelle?inboxItem=${id}`,
  createIntervention: (id) => `/travaux/interventions/nouvelle?inboxItem=${id}`,
};

const NEXT_STATUS: Record<InboxDecision, string | null> = {
  attach: "attached",
  dismiss: "rejected",
  quarantine: "quarantined",
  createExpense: "analyzed",
  createIntervention: "analyzed",
};

async function applyStatus(
  tx: Tx,
  input: {
    id: string;
    expectedVersion: number;
    status: string;
    reason: string | null;
    objectRefId: string | null;
    actorId: string | null;
  },
): Promise<void> {
  const updated = [
    ...(await tx.execute<{ id: string }>(sql`
      UPDATE inbox_item
         SET status = ${input.status},
             rejected_reason = ${input.reason},
             proposed_object_ref_id = COALESCE(${input.objectRefId}::uuid, proposed_object_ref_id),
             processed_at = now(),
             processed_by = ${input.actorId}::uuid,
             version = version + 1,
             updated_at = now()
       WHERE id = ${input.id}::uuid AND version = ${input.expectedVersion}
      RETURNING id`)),
  ];
  if (updated.length > 0) return;

  const current = [
    ...(await tx.execute<{ version: number; status: string }>(
      sql`SELECT version, status FROM inbox_item WHERE id = ${input.id}::uuid`,
    )),
  ];
  const row = current[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { inboxItemId: input.id } });
  throw new AppError("VERSION_CONFLICT", {
    details: {
      inboxItemId: input.id,
      expectedVersion: input.expectedVersion,
      actualVersion: row.version,
    },
  });
}

export async function decideInbox(
  scope: TenantScope,
  input: DecideInput,
): Promise<InboxDecisionResult> {
  if (input.decision === "attach" && !input.attachTo) {
    throw new AppError("VALIDATION", { message: "Un rattachement demande un objet cible." });
  }
  if (input.decision === "dismiss" && !input.reason) {
    throw new AppError("VALIDATION", { message: "Un abandon doit être motivé." });
  }

  const actorId = scope.session?.user.id ?? null;
  const organizationId = scope.organizationId;

  return tenant(scope, async (tx) => {
    const before = await readRow(tx, input.id);

    let objectRefId: string | null = null;
    if (input.attachTo) {
      objectRefId = await ensureObjectRef(tx, {
        organizationId,
        kind: input.attachTo.kind as ObjectKind,
        id: input.attachTo.id,
      });
      if (before.activity_id) {
        await linkActivity(tx, { organizationId, activityId: before.activity_id, objectRefId });
      }
    }

    const status = NEXT_STATUS[input.decision] ?? before.status;
    await applyStatus(tx, {
      id: input.id,
      expectedVersion: input.expectedVersion,
      status,
      reason: input.decision === "dismiss" ? (input.reason ?? null) : null,
      objectRefId,
      actorId,
    });

    await recordAudit(tx, {
      organizationId,
      actorKind: actorId ? "user" : "system",
      actorUserId: actorId,
      objectTable: "inbox_item",
      objectId: input.id,
      action: `inbox.${input.decision}`,
      reason: input.reason ?? null,
      beforeValue: { status: before.status },
      afterValue: { status, attachedTo: input.attachTo ?? null },
    });

    const after = await readRow(tx, input.id);
    const item: InboxRow = toRow(after);
    return { item, handoffHref: HANDOFF[input.decision]?.(input.id) ?? null };
  });
}
