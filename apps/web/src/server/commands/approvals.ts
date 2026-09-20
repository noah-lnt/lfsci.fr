import "server-only";
import type { ApprovalDecision } from "@lfsci/contracts";
import { CommandPayload, CommandState } from "@lfsci/contracts";
import type { Tx } from "@lfsci/db";
import { assertApprovalValid, recordApproval, recordAudit, transitionCommand } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type {
  ApprovalsPendingResult,
  DecidedApproval,
  PendingApproval,
} from "@/lib/contracts/commands";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { enqueueJob } from "../queue";
import { approvalExpiry, describeCommand } from "./decision";
import { authorizeAndEnqueue } from "./submit";

type PendingRaw = {
  id: string;
  version: number;
  command_type: string;
  autonomy_level: PendingApproval["level"];
  payload: unknown;
  payload_hash: string;
  created_at: string;
};

function summarize(commandType: string, payload: unknown) {
  const parsed = CommandPayload.safeParse({ command: commandType, payload });
  if (parsed.success) return describeCommand(parsed.data);
  return {
    what: commandType,
    amount: null,
    currency: "EUR",
    pieces: [],
    expectedEffect: "Effet non décrit : le payload ne correspond pas au contrat de cette commande.",
  };
}

export async function listApprovals(
  scope: TenantScope,
  input: { historyLimit: number },
): Promise<ApprovalsPendingResult> {
  return tenant(scope, async (tx) => {
    const pending = [
      ...(await tx.execute<PendingRaw>(sql`
        SELECT c.id, c.version, c.command_type, c.autonomy_level, c.payload, c.payload_hash,
               to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_at
          FROM command c
         WHERE c.status = 'prepared' AND c.autonomy_level IN ('C', 'D')
           AND NOT EXISTS (SELECT 1 FROM approval a
                            WHERE a.command_id = c.id AND a.decision = 'approved'
                              AND a.revoked_at IS NULL AND a.expires_at > now()
                              AND a.approved_payload_hash = c.payload_hash)
         ORDER BY c.created_at
         LIMIT 100`)),
    ] as PendingRaw[];

    const decided = [
      ...(await tx.execute<{
        id: string;
        command_id: string;
        command_type: string;
        decision: ApprovalDecision;
        reason: string | null;
        approved_at: string;
        expires_at: string;
        revoked_at: string | null;
      }>(sql`
        SELECT a.id, a.command_id, c.command_type, a.decision, a.refusal_reason AS reason,
               to_char(a.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS approved_at,
               to_char(a.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS expires_at,
               to_char(a.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS revoked_at
          FROM approval a JOIN command c ON c.id = a.command_id
         ORDER BY a.approved_at DESC
         LIMIT ${input.historyLimit}`)),
    ];

    return {
      pending: pending.map((row) => ({
        commandId: row.id,
        version: row.version,
        commandType: row.command_type,
        level: row.autonomy_level,
        payloadHash: row.payload_hash,
        targetObject: null,
        createdAt: row.created_at,
        ...summarize(row.command_type, row.payload),
      })),
      decided: decided.map(
        (row): DecidedApproval => ({
          approvalId: row.id,
          commandId: row.command_id,
          commandType: row.command_type,
          decision: row.decision,
          reason: row.reason,
          decidedAt: row.approved_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        }),
      ),
    };
  });
}

async function readCommand(tx: Tx, id: string) {
  const found = [
    ...(await tx.execute<{
      id: string;
      version: number;
      status: CommandState;
      command_type: string;
      operation_key: string;
      payload: unknown;
      payload_hash: string;
    }>(
      sql`SELECT id, version, status, command_type, operation_key, payload, payload_hash
            FROM command WHERE id = ${id}::uuid LIMIT 1`,
    )),
  ];
  const row = found[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { commandId: id } });
  return row;
}

export type DecideInput = {
  commandId: string;
  expectedVersion: number;
  payloadHash: string;
  decision: ApprovalDecision;
  reason?: string | undefined;
};

/**
 * IA-03: the decision binds the hash the owner saw; the approval is revalidated
 * immediately before the command leaves `prepared`.
 */
export async function decideApproval(
  scope: TenantScope,
  approverUserId: string,
  input: DecideInput,
): Promise<{ commandId: string; status: CommandState }> {
  if (input.decision === "refused" && !input.reason) {
    throw new AppError("VALIDATION", { message: "Un refus doit être motivé." });
  }
  const organizationId = scope.organizationId;

  const result = await tenant(scope, async (tx) => {
    const command = await readCommand(tx, input.commandId);
    if (command.payload_hash !== input.payloadHash) {
      throw new AppError("APPROVAL_INVALID", {
        details: { commandId: command.id, reason: "payload_hash_mismatch" },
      });
    }

    if (input.decision === "refused") {
      await recordApproval(tx, {
        organizationId,
        commandId: command.id,
        approvedPayloadHash: command.payload_hash,
        approverUserId,
        expiresAt: approvalExpiry(new Date()),
        decision: "refused",
        refusalReason: input.reason ?? "",
      });
      const cancelled = await transitionCommand(
        tx,
        command.id,
        "prepared",
        "cancelled",
        input.expectedVersion,
        { errorType: "permission", errorDetail: input.reason ?? null },
      );
      await recordAudit(tx, {
        organizationId,
        actorKind: "user",
        actorUserId: approverUserId,
        objectTable: "command",
        objectId: command.id,
        action: "approval.refuse",
        reason: input.reason ?? null,
        result: "refused",
      });
      return {
        commandId: cancelled.id,
        status: CommandState.parse(cancelled.status),
        enqueued: false,
      };
    }

    const approval = await recordApproval(tx, {
      organizationId,
      commandId: command.id,
      approvedPayloadHash: command.payload_hash,
      approverUserId,
      expiresAt: approvalExpiry(new Date()),
    });
    await assertApprovalValid(tx, command.id, command.payload_hash);

    const authorized = await authorizeAndEnqueue(
      tx,
      organizationId,
      {
        id: command.id,
        version: input.expectedVersion,
        operationKey: command.operation_key,
        commandType: command.command_type,
        payload: command.payload,
        payloadHash: command.payload_hash,
      } as Parameters<typeof authorizeAndEnqueue>[2],
      approval.id,
    );

    await recordAudit(tx, {
      organizationId,
      actorKind: "user",
      actorUserId: approverUserId,
      objectTable: "command",
      objectId: command.id,
      action: "approval.approve",
      approvalId: approval.id,
      afterValue: { status: authorized.status },
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
