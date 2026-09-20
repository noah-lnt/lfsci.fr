import "server-only";
import type { CommandEnvelope, SubmitCommandOutput } from "@lfsci/contracts";
import { CommandState, resolveDecisionLevel } from "@lfsci/contracts";
import type { CommandRow as DbCommandRow, Tx } from "@lfsci/db";
import {
  createCommand,
  enqueueOutbox,
  hashPayload,
  recordAudit,
  transitionCommand,
} from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { enqueueJob } from "../queue";
import { needsApproval } from "./decision";

function levelOf(envelope: CommandEnvelope) {
  if (envelope.command === "post_supplier_bill") {
    return resolveDecisionLevel(envelope.command, {
      isNewSupplier: envelope.payload.isNewSupplier,
      paymentIdentityChanged: envelope.payload.paymentIdentityChanged,
    });
  }
  return resolveDecisionLevel(envelope.command);
}

/** ARC-02: the hash the client signed must be the hash of what it actually sent. */
function assertHash(envelope: CommandEnvelope): string {
  const computed = hashPayload(envelope.payload);
  if (computed !== envelope.payloadHash) {
    throw new AppError("VALIDATION", {
      message: "L’empreinte du payload ne correspond pas à son contenu.",
      details: { computed, submitted: envelope.payloadHash },
    });
  }
  return computed;
}

/**
 * `rent.prepareTerms` already parks an `outbox_entry` at year 2999 for the command
 * it prepares: authorizing releases that row instead of queueing a second one.
 */
export async function authorizeAndEnqueue(
  tx: Tx,
  organizationId: string,
  command: DbCommandRow,
  approvalId: string | null,
): Promise<DbCommandRow> {
  const authorized = await transitionCommand(
    tx,
    command.id,
    "prepared",
    "authorized",
    command.version,
    approvalId ? { approvalId } : {},
  );

  const released = [
    ...(await tx.execute<{ id: string }>(sql`
      UPDATE outbox_entry
         SET status = 'pending', available_at = now(), lease_owner = NULL,
             lease_expires_at = NULL, version = version + 1, updated_at = now()
       WHERE command_id = ${command.id}::uuid
         AND status IN ('pending', 'leased', 'failed')
      RETURNING id`)),
  ];
  if (released.length === 0) {
    await enqueueOutbox(tx, {
      organizationId,
      kind: "odoo",
      commandId: command.id,
      partitionKey: command.operationKey,
      payload: { command: command.commandType, payload: command.payload },
      payloadHash: command.payloadHash,
    });
  }
  return authorized;
}

export async function submitCommand(
  scope: TenantScope,
  envelope: CommandEnvelope,
): Promise<SubmitCommandOutput> {
  const payloadHash = assertHash(envelope);
  const level = levelOf(envelope);
  const organizationId = scope.organizationId;
  const actorUserId = scope.session?.user.id ?? null;

  const result = await tenant(scope, async (tx) => {
    const command = await createCommand(tx, {
      organizationId,
      commandType: envelope.command,
      operationKey: envelope.operationId,
      payload: envelope.payload,
      payloadHash,
      expectedVersion: envelope.expectedVersion,
      actorUserId,
      autonomyLevel: level,
      correlationId: envelope.requestId,
      authorizationScope: { objectId: envelope.objectId },
    });

    if (command.status !== "prepared" || needsApproval(level)) {
      return { commandId: command.id, status: CommandState.parse(command.status), enqueued: false };
    }

    const authorized = await authorizeAndEnqueue(tx, organizationId, command, null);
    await recordAudit(tx, {
      organizationId,
      actorKind: actorUserId ? "user" : "system",
      actorUserId,
      objectTable: "command",
      objectId: command.id,
      action: "command.authorize",
      afterValue: { level, status: authorized.status },
    });
    return {
      commandId: authorized.id,
      status: CommandState.parse(authorized.status),
      enqueued: true,
    };
  });

  if (result.enqueued) await enqueueJob("outbox.dispatch", { organizationId });
  return { commandId: result.commandId, status: result.status };
}
