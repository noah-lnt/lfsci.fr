import type { CommandRow, OutboxRow, Tx } from "@lfsci/db";
import {
  assertApprovalValid,
  claimOutbox,
  completeOutbox,
  failOutbox,
  finishCommandAttempt,
  mapExternal,
  recordCommandAttempt,
  tables,
  transitionCommand,
  withoutTenant,
  withTenant,
} from "@lfsci/db";
import { AppError, isAppError, logger, toAppError } from "@lfsci/kernel";
import { isTransportError, OPERATION_REF_PREFIX } from "@lfsci/odoo";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createBreaker } from "../breaker";
import { JobBase } from "../correlation";
import type { Deps, OdooPort } from "../deps";
import { withExchangeContext } from "../exchange-recorder";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.outbox.dispatch");

export const OUTBOX_LEASE_SECONDS = 300;
export const OUTBOX_CLAIM_LIMIT = 20;
export const BREAKER_THRESHOLD = 5;
export const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

export const odooBreaker = createBreaker({
  name: "odoo",
  threshold: BREAKER_THRESHOLD,
  cooldownMs: BREAKER_COOLDOWN_MS,
});

export const OutboxDispatchData = JobBase.extend({
  limit: z.number().int().min(1).max(100).default(OUTBOX_CLAIM_LIMIT),
});
export type OutboxDispatchData = z.infer<typeof OutboxDispatchData>;

export function operationRefFor(commandId: string): string {
  return `${OPERATION_REF_PREFIX}${commandId}`;
}

const errorTypeByCode: Record<string, CommandRow["errorType"]> = {
  PERIOD_LOCKED: "closed_period",
  QUOTA_EXCEEDED: "quota",
  UPSTREAM_UNAVAILABLE: "provider_unavailable",
  UPSTREAM_REJECTED: "validation",
  RESULT_UNKNOWN: "unknown_result",
  AMBIGUOUS_REFERENCE: "ambiguous_reference",
  VERSION_CONFLICT: "version_conflict",
  APPROVAL_INVALID: "permission",
  VALIDATION: "validation",
};

/** Business rejections are terminal and visible; they never feed the breaker (SYN-06). */
const terminalCodes = new Set([
  "PERIOD_LOCKED",
  "UPSTREAM_REJECTED",
  "AMBIGUOUS_REFERENCE",
  "APPROVAL_INVALID",
  "VERSION_CONFLICT",
  "VALIDATION",
  "RULE_VIOLATION",
]);

export type OperationResult = {
  externalId: number | null;
  model: string | null;
  internalTable: string | null;
  internalId: string | null;
};

/**
 * One typed Odoo operation per command type. A type with no entry here has no
 * confirmed Odoo entry point yet and is refused terminally rather than guessed.
 */
export async function runOperation(
  odoo: OdooPort,
  command: CommandRow,
  operationRef: string,
): Promise<OperationResult> {
  const payload = command.payload as Record<string, unknown>;

  switch (command.commandType) {
    case "post_supplier_bill": {
      const partner = await odoo.operations.findPartnerByRef(String(payload.supplierReference));
      if (!partner) {
        throw new AppError("NOT_FOUND", {
          message: "fournisseur absent d'Odoo",
          details: { supplierReference: payload.supplierReference },
        });
      }
      const created = await odoo.operations.createDraftSupplierBill({
        partnerId: partner.id,
        invoiceDate: String(payload.issuedOn),
        ref: String(payload.supplierReference),
        lines: [
          {
            name: String(payload.supplierReference),
            priceUnit: Number(payload.totalExclTax),
          },
        ],
        operationRef,
      });
      return {
        externalId: created.id,
        model: "account.move",
        internalTable: "expense",
        internalId: String(payload.expenseId),
      };
    }

    case "attach_document_to_odoo": {
      const created = await odoo.operations.attachDocument({
        name: String(payload.documentId),
        base64: String(payload.base64 ?? ""),
        resModel: String(payload.odooModel),
        resId: Number(payload.odooRecordId),
        operationRef,
      });
      return {
        externalId: created.id,
        model: "ir.attachment",
        internalTable: "document_version",
        internalId: String(payload.documentVersionId),
      };
    }

    case "propose_reconciliation": {
      await odoo.operations.proposeReconciliation({
        statementLineId: Number(payload.bankTransactionId),
        moveLineIds: [],
        operationRef,
      });
      return { externalId: null, model: null, internalTable: null, internalId: null };
    }

    default:
      throw new AppError("RULE_VIOLATION", {
        message: `aucune opération Odoo typée pour la commande ${command.commandType}`,
        details: { commandType: command.commandType, reason: "no_typed_operation" },
      });
  }
}

async function loadCommand(tx: Tx, commandId: string): Promise<CommandRow> {
  const rows = await tx
    .select()
    .from(tables.command)
    .where(eq(tables.command.id, commandId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { commandId } });
  return row;
}

/**
 * Puts an entry this worker does not serve back exactly as it was found: the
 * claim already burned one attempt, so it is given back.
 */
async function releaseOutbox(tx: Tx, id: string, retryInSeconds: number): Promise<void> {
  await tx.execute(sql`
    UPDATE outbox_entry
       SET status = 'pending',
           lease_owner = NULL,
           lease_expires_at = NULL,
           attempts = GREATEST(attempts - 1, 0),
           available_at = now() + make_interval(secs => ${retryInSeconds}::double precision),
           updated_at = now()
     WHERE id = ${id}::uuid
  `);
}

export type EntryOutcome =
  | "confirmed"
  | "rejected"
  | "unknown_result"
  | "retry"
  | "released"
  | "skipped";

export async function dispatchEntry(deps: Deps, entry: OutboxRow): Promise<EntryOutcome> {
  const organizationId = entry.organizationId;

  if (entry.channel !== "odoo") {
    await withTenant(deps.db, { organizationId }, (tx) => releaseOutbox(tx, entry.id, 60));
    return "released";
  }
  if (!entry.commandId) {
    await withTenant(deps.db, { organizationId }, (tx) =>
      failOutbox(tx, entry.id, { error: "outbox entry on channel odoo without a command" }),
    );
    return "rejected";
  }
  if (!deps.odoo) {
    await withTenant(deps.db, { organizationId }, (tx) =>
      failOutbox(tx, entry.id, { error: "odoo connector not configured", retryInSeconds: 600 }),
    );
    return "retry";
  }
  if (odooBreaker.state(deps.now().getTime()) === "open") {
    await withTenant(deps.db, { organizationId }, (tx) => releaseOutbox(tx, entry.id, 60));
    return "skipped";
  }

  const commandId = entry.commandId;
  const odoo = deps.odoo;
  const operationRef = operationRefFor(commandId);

  // Re-check and move to `sent` in one transaction, so a crash leaves a state the
  // reconciler can read, never a call nobody knows about (SYN-01).
  const prepared = await withTenant(deps.db, { organizationId }, async (tx) => {
    const command = await loadCommand(tx, commandId);
    if (command.status !== "authorized") {
      return {
        ok: false as const,
        command,
        reason: `command is ${command.status}, not authorized`,
      };
    }
    if (command.approvalId !== null || command.autonomyLevel === "D") {
      await assertApprovalValid(tx, command.id, command.payloadHash, deps.now());
    }
    const sent = await transitionCommand(tx, command.id, "authorized", "sent", command.version);
    const attempt = await recordCommandAttempt(tx, {
      organizationId,
      commandId: command.id,
      step: command.commandType,
      outcome: "running",
      workerId: deps.workerId,
      lockGeneration: entry.leaseGeneration,
    });
    return { ok: true as const, command: sent, attemptId: attempt.id };
  }).catch((error: unknown) => ({ ok: false as const, error: toAppError(error) }));

  if (!prepared.ok) {
    const appError = "error" in prepared ? prepared.error : undefined;
    const reason = appError ? appError.message : (prepared as { reason: string }).reason;
    await withTenant(deps.db, { organizationId }, async (tx) => {
      await failOutbox(tx, entry.id, { error: reason });
      if (appError && terminalCodes.has(appError.code)) {
        const current = await loadCommand(tx, commandId);
        if (current.status === "authorized" || current.status === "prepared") {
          await transitionCommand(tx, current.id, current.status, "rejected", current.version, {
            errorType: errorTypeByCode[appError.code] ?? "validation",
            errorDetail: reason.slice(0, 2000),
          });
        }
      }
    });
    log.warn({ commandId, reason }, "command refused before the external call");
    return "rejected";
  }

  const { command, attemptId } = prepared;
  const startedAt = deps.now().toISOString();

  try {
    const result = await withExchangeContext({ organizationId, commandId }, () =>
      runOperation(odoo, command, operationRef),
    );
    odooBreaker.recordSuccess();

    await withTenant(deps.db, { organizationId }, async (tx) => {
      let externalRefId: string | null = null;
      if (result.externalId !== null && result.model && result.internalTable && result.internalId) {
        const mapped = await mapExternal(tx, {
          organizationId,
          model: result.model,
          externalId: result.externalId,
          internalId: result.internalId,
          internalTable: result.internalTable,
          odooDatabase: odoo.database,
        });
        externalRefId = mapped.id;
      }
      await finishCommandAttempt(tx, attemptId, "success");
      await transitionCommand(tx, command.id, "sent", "confirmed", command.version, {
        ...(externalRefId ? { externalRefId } : {}),
      });
      await completeOutbox(tx, entry.id, "confirmed");
    });
    return "confirmed";
  } catch (error) {
    const appError = toAppError(error);
    const transport = isTransportError(isAppError(error) ? error : appError);
    const detail = `${appError.code}: ${appError.message}`.slice(0, 2000);

    if (appError.code === "RESULT_UNKNOWN") {
      // SYN-03: never re-emit blindly. The reconciler searches the stable ref.
      await withTenant(deps.db, { organizationId }, async (tx) => {
        await finishCommandAttempt(tx, attemptId, "unknown", { responseExcerpt: detail });
        await transitionCommand(tx, command.id, "sent", "unknown_result", command.version, {
          errorType: "unknown_result",
          errorDetail: detail,
        });
        await completeOutbox(tx, entry.id, "sent");
      });
      await deps.boss.sendAfter(
        "outbox.reconcile",
        { requestId: command.correlationId, organizationId, commandId, operationRef, tries: 0 },
        {},
        Math.ceil(odoo.timeoutMs / 1000) + 60,
      );
      return "unknown_result";
    }

    if (transport && !terminalCodes.has(appError.code)) {
      odooBreaker.recordTransportFailure(deps.now().getTime());
      await withTenant(deps.db, { organizationId }, async (tx) => {
        await finishCommandAttempt(tx, attemptId, "failure", { responseExcerpt: detail });
        await transitionCommand(tx, command.id, "sent", "authorized", command.version, {
          errorType: errorTypeByCode[appError.code] ?? "provider_unavailable",
          errorDetail: detail,
        });
        await failOutbox(tx, entry.id, { error: detail, retryInSeconds: backoffSeconds(entry) });
      });
      return "retry";
    }

    odooBreaker.recordBusinessRejection();
    await withTenant(deps.db, { organizationId }, async (tx) => {
      await finishCommandAttempt(tx, attemptId, "failure", { responseExcerpt: detail });
      await transitionCommand(tx, command.id, "sent", "rejected", command.version, {
        errorType: errorTypeByCode[appError.code] ?? "validation",
        errorDetail: detail,
      });
      await failOutbox(tx, entry.id, { error: detail });
      // A terminal refusal must not come back: it is dead-lettered outright.
      await tx.execute(
        sql`UPDATE outbox_entry SET status = 'dead_letter', updated_at = now() WHERE id = ${entry.id}::uuid`,
      );
    });
    log.warn({ commandId, code: appError.code, startedAt }, "command rejected by Odoo");
    return "rejected";
  }
}

export function backoffSeconds(entry: OutboxRow): number {
  return Math.min(3600, 30 * 2 ** Math.min(entry.attempts, 7));
}

export async function dispatchOnce(deps: Deps, limit: number): Promise<JobOutcome> {
  const entries = await withoutTenant(deps.admin, (tx) =>
    claimOutbox(tx, {
      limit,
      workerId: deps.workerId,
      leaseSeconds: OUTBOX_LEASE_SECONDS,
      channels: ["odoo"],
    }),
  );
  if (entries.length === 0) return { outcome: "idle", claimed: 0 };

  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const result = await dispatchEntry(deps, entry);
    counts[result] = (counts[result] ?? 0) + 1;
  }
  return { outcome: "processed", claimed: entries.length, ...counts };
}

export const outboxDispatch = defineJob({
  name: "outbox.dispatch",
  schema: OutboxDispatchData,
  // Concurrency 1 toward Odoo: the connector serialises, and a second worker
  // would only queue behind its token bucket (tech pack §5.7).
  options: {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 900,
    localConcurrency: 1,
    batchSize: 1,
  },
  schedule: { cron: "* * * * *", tz: "Europe/Paris" },
  handler: (data, deps) => dispatchOnce(deps, data.limit),
});
