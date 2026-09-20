import type { CommandRow } from "@lfsci/db";
import { mapExternal, tables, transitionCommand, withTenant } from "@lfsci/db";
import { AppError, logger, toAppError } from "@lfsci/kernel";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { withExchangeContext } from "../exchange-recorder";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.outbox.reconcile");

export const MAX_RECONCILE_TRIES = 6;
/** Beyond the client timeout plus this margin, a lost call can no longer be running (SYN-03). */
export const SAFETY_MARGIN_MS = 120_000;

export const OutboxReconcileData = JobBase.extend({
  organizationId: z.uuid(),
  commandId: z.uuid(),
  operationRef: z.string().min(1),
  tries: z.number().int().min(0).default(0),
});
export type OutboxReconcileData = z.infer<typeof OutboxReconcileData>;

async function loadCommand(
  deps: Deps,
  organizationId: string,
  commandId: string,
): Promise<CommandRow | undefined> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(tables.command)
      .where(eq(tables.command.id, commandId))
      .limit(1);
    return rows[0];
  });
}

async function lastAttemptStartedAt(
  deps: Deps,
  organizationId: string,
  commandId: string,
): Promise<Date | null> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select({ startedAt: tables.commandAttempt.startedAt })
      .from(tables.commandAttempt)
      .where(
        and(
          eq(tables.commandAttempt.commandId, commandId),
          eq(tables.commandAttempt.outcome, "unknown"),
        ),
      )
      .orderBy(sql`started_at DESC`)
      .limit(1);
    const row = rows[0];
    return row ? new Date(row.startedAt) : null;
  });
}

const internalTargetByCommand: Record<string, { internalTable: string; payloadKey: string }> = {
  post_supplier_bill: { internalTable: "expense", payloadKey: "expenseId" },
  attach_document_to_odoo: { internalTable: "document_version", payloadKey: "documentVersionId" },
};

export async function reconcileOnce(deps: Deps, data: OutboxReconcileData): Promise<JobOutcome> {
  const { organizationId, commandId, operationRef } = data;
  const odoo = deps.odoo;
  if (!odoo) return { outcome: "sources_unavailable", reason: "odoo not configured" };

  const command = await loadCommand(deps, organizationId, commandId);
  if (!command) return { outcome: "not_found", commandId };
  if (command.status !== "unknown_result") {
    return { outcome: "already_settled", status: command.status };
  }

  let match: Awaited<ReturnType<typeof odoo.operations.findByOperationRef>>;
  try {
    match = await withExchangeContext({ organizationId, commandId }, () =>
      odoo.operations.findByOperationRef(operationRef),
    );
  } catch (error) {
    const appError = toAppError(error);
    log.warn({ commandId, code: appError.code }, "reconcile search failed");
    return scheduleRetry(deps, data, `search failed: ${appError.code}`);
  }

  if (match.kind === "one") {
    await withTenant(deps.db, { organizationId }, async (tx) => {
      const target = internalTargetByCommand[command.commandType];
      let externalRefId: string | null = null;
      if (target) {
        const payload = command.payload as Record<string, unknown>;
        const internalId = payload[target.payloadKey];
        if (typeof internalId === "string") {
          const mapped = await mapExternal(tx, {
            organizationId,
            model: match.model,
            externalId: match.id,
            internalId,
            internalTable: target.internalTable,
            odooDatabase: odoo.database,
          });
          externalRefId = mapped.id;
        }
      }
      await transitionCommand(tx, command.id, "unknown_result", "confirmed", command.version, {
        errorType: null,
        errorDetail: null,
        ...(externalRefId ? { externalRefId } : {}),
      });
      await tx.execute(
        sql`UPDATE outbox_entry SET status = 'confirmed', updated_at = now() WHERE command_id = ${commandId}::uuid`,
      );
    });
    return { outcome: "confirmed", model: match.model, externalId: match.id };
  }

  if (match.kind === "many") {
    await markConflict(deps, command, `plusieurs enregistrements portent ${operationRef}`);
    return { outcome: "conflict", matches: match.matches.length };
  }

  // kind === "none": absence only proves anything once the original call can no
  // longer be executing.
  const startedAt = await lastAttemptStartedAt(deps, organizationId, commandId);
  const elapsed = startedAt ? deps.now().getTime() - startedAt.getTime() : 0;
  if (startedAt && elapsed > odoo.timeoutMs + SAFETY_MARGIN_MS) {
    await withTenant(deps.db, { organizationId }, async (tx) => {
      await transitionCommand(tx, command.id, "unknown_result", "authorized", command.version, {
        errorType: null,
        errorDetail: "absence prouvée après le délai client : une reprise contrôlée est autorisée",
      });
      await tx.execute(sql`
        UPDATE outbox_entry
           SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
               available_at = now(), updated_at = now()
         WHERE command_id = ${commandId}::uuid
      `);
    });
    return { outcome: "retry_allowed", elapsedMs: elapsed };
  }

  return scheduleRetry(deps, data, "absence not yet provable");
}

async function markConflict(deps: Deps, command: CommandRow, reason: string): Promise<void> {
  await withTenant(deps.db, { organizationId: command.organizationId }, async (tx) => {
    await transitionCommand(tx, command.id, "unknown_result", "conflict", command.version, {
      errorType: "ambiguous_reference",
      errorDetail: reason.slice(0, 2000),
    });
    await tx.execute(
      sql`UPDATE outbox_entry SET status = 'dead_letter', last_error = ${reason}, updated_at = now() WHERE command_id = ${command.id}::uuid`,
    );
  });
}

async function scheduleRetry(
  deps: Deps,
  data: OutboxReconcileData,
  reason: string,
): Promise<JobOutcome> {
  const tries = data.tries + 1;
  if (tries >= MAX_RECONCILE_TRIES) {
    const command = await loadCommand(deps, data.organizationId, data.commandId);
    if (!command) throw new AppError("NOT_FOUND", { details: { commandId: data.commandId } });
    await markConflict(deps, command, `réconciliation abandonnée après ${tries} essais: ${reason}`);
    return { outcome: "conflict", tries, reason };
  }
  await deps.boss.sendAfter(
    "outbox.reconcile",
    { ...data, tries },
    {},
    Math.min(3600, 60 * 2 ** tries),
  );
  return { outcome: "rescheduled", tries, reason };
}

export const outboxReconcile = defineJob({
  name: "outbox.reconcile",
  schema: OutboxReconcileData,
  // Rescheduling is explicit (`sendAfter` with the try count), so pg-boss never
  // retries a reconcile on its own and the try budget stays observable.
  options: {
    retryLimit: 0,
    retryDelay: 0,
    retryBackoff: false,
    expireInSeconds: 300,
    localConcurrency: 1,
  },
  handler: (data, deps) => reconcileOnce(deps, data),
});
