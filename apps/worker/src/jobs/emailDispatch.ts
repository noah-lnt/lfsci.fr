import type { CommandRow, OutboxRow, Tx } from "@lfsci/db";
import {
  assertApprovalValid,
  claimOutbox,
  completeOutbox,
  failOutbox,
  finishCommandAttempt,
  recordCommandAttempt,
  tables,
  transitionCommand,
  withoutTenant,
  withTenant,
} from "@lfsci/db";
import { AppError, logger, toAppError } from "@lfsci/kernel";
import { createHttpMailer, MailConfig, type Mailer } from "@lfsci/mail";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.email.dispatch");

export const EMAIL_LEASE_SECONDS = 180;
export const EMAIL_CLAIM_LIMIT = 20;
export const PROVIDER = "resend";

export const EmailDispatchData = JobBase.extend({
  limit: z.number().int().min(1).max(100).default(EMAIL_CLAIM_LIMIT),
});
export type EmailDispatchData = z.infer<typeof EmailDispatchData>;

export type EmailOutcome =
  | "sent"
  | "duplicate"
  | "rejected"
  | "retry"
  | "unknown_result"
  | "released";

/** A refusal of this message: retrying it would only spend another call. */
const terminalCodes = new Set([
  "VALIDATION",
  "UPSTREAM_REJECTED",
  "PAYLOAD_TOO_LARGE",
  "APPROVAL_INVALID",
  "VERSION_CONFLICT",
  "RULE_VIOLATION",
]);

type MessageRow = typeof tables.messageOutbound.$inferSelect;

export function mailerFor(deps: Deps): Mailer | null {
  const { RESEND_API_KEY, RESEND_FROM, MAIL_FROM } = deps.env;
  const from = RESEND_FROM ?? MAIL_FROM;
  if (!RESEND_API_KEY || !from) return null;
  return createHttpMailer({ config: MailConfig.parse({ apiKey: RESEND_API_KEY, from }) });
}

async function loadMessage(tx: Tx, id: string): Promise<MessageRow> {
  const rows = await tx
    .select()
    .from(tables.messageOutbound)
    .where(eq(tables.messageOutbound.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { messageOutboundId: id } });
  return row;
}

async function loadCommand(tx: Tx, id: string): Promise<CommandRow> {
  const rows = await tx.select().from(tables.command).where(eq(tables.command.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { commandId: id } });
  return row;
}

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

async function deadLetter(tx: Tx, id: string): Promise<void> {
  await tx.execute(
    sql`UPDATE outbox_entry SET status = 'dead_letter', updated_at = now() WHERE id = ${id}::uuid`,
  );
}

/** MSG-01: a refused send stays readable — the owner sees who, why and with which template. */
async function openException(
  tx: Tx,
  organizationId: string,
  message: MessageRow,
  reason: string,
): Promise<void> {
  const reference = `message:${message.id}:rejected`;
  const existing = await tx
    .select({ id: tables.inboxItem.id })
    .from(tables.inboxItem)
    .where(
      and(
        eq(tables.inboxItem.source, "connector"),
        eq(tables.inboxItem.sourceReference, reference),
      ),
    )
    .limit(1);
  if (existing[0]) return;

  const objectRefId = message.relatedObjectRefId;
  await tx.insert(tables.inboxItem).values({
    organizationId,
    source: "connector",
    sourceReference: reference,
    proposedObjectRefId: objectRefId,
    proposedAction: "review_message_rejected",
    uncertaintyReason:
      `Envoi refusé vers ${message.recipientAddress} (${message.templateCode ?? "sans modèle"}) : ${reason}`.slice(
        0,
        500,
      ),
    status: "ambiguous",
  });
}

export async function dispatchEmailEntry(
  deps: Deps,
  entry: OutboxRow,
  mailer: Mailer | null,
): Promise<EmailOutcome> {
  const organizationId = entry.organizationId;

  if (entry.channel !== "email") {
    await withTenant(deps.db, { organizationId }, (tx) => releaseOutbox(tx, entry.id, 60));
    return "released";
  }
  if (!entry.messageOutboundId) {
    await withTenant(deps.db, { organizationId }, async (tx) => {
      await failOutbox(tx, entry.id, { error: "outbox entry on channel email without a message" });
      await deadLetter(tx, entry.id);
    });
    return "rejected";
  }
  if (!mailer) {
    await withTenant(deps.db, { organizationId }, (tx) =>
      failOutbox(tx, entry.id, { error: "mail provider not configured", retryInSeconds: 600 }),
    );
    return "retry";
  }

  const messageId = entry.messageOutboundId;

  // The trace is written and committed here; the send happens after, never inside
  // a transaction that could roll it back (spec §16.3: no effect without a trace).
  const prepared = await withTenant(deps.db, { organizationId }, async (tx) => {
    const message = await loadMessage(tx, messageId);

    if (message.providerMessageId !== null) {
      return { ok: false as const, duplicate: true as const, message };
    }
    if (message.status === "cancelled") {
      return { ok: false as const, duplicate: false as const, message, reason: "message annulé" };
    }

    let command: CommandRow | null = null;
    let attemptId: string | null = null;
    if (entry.commandId) {
      command = await loadCommand(tx, entry.commandId);
      if (command.status !== "authorized") {
        return {
          ok: false as const,
          duplicate: false as const,
          message,
          reason: `command is ${command.status}, not authorized`,
        };
      }
      if (command.approvalId !== null || command.autonomyLevel === "D") {
        await assertApprovalValid(tx, command.id, command.payloadHash, deps.now());
      }
      command = await transitionCommand(tx, command.id, "authorized", "sent", command.version);
      const attempt = await recordCommandAttempt(tx, {
        organizationId,
        commandId: command.id,
        step: "send_message",
        outcome: "running",
        workerId: deps.workerId,
        lockGeneration: entry.leaseGeneration,
      });
      attemptId = attempt.id;
    }

    const traced = await tx
      .update(tables.messageOutbound)
      .set({
        status: "queued",
        provider: PROVIDER,
        attempts: sql`${tables.messageOutbound.attempts} + 1`,
        firstAttemptAt: sql`COALESCE(${tables.messageOutbound.firstAttemptAt}, now())`,
        lastAttemptAt: sql`now()`,
        version: sql`${tables.messageOutbound.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.messageOutbound.id, message.id),
          eq(tables.messageOutbound.version, message.version),
        ),
      )
      .returning();
    const row = traced[0];
    if (!row) {
      return {
        ok: false as const,
        duplicate: false as const,
        message,
        reason: "message modifié pendant la prise en charge",
      };
    }
    return { ok: true as const, message: row, command, attemptId };
  }).catch((error: unknown) => ({ ok: false as const, error: toAppError(error) }));

  if (!prepared.ok) {
    if ("duplicate" in prepared && prepared.duplicate) {
      await withTenant(deps.db, { organizationId }, (tx) => completeOutbox(tx, entry.id, "sent"));
      log.info({ messageId, dedupKey: prepared.message.dedupKey }, "message already sent, skipped");
      return "duplicate";
    }
    const reason =
      "error" in prepared ? `${prepared.error.code}: ${prepared.error.message}` : prepared.reason;
    await withTenant(deps.db, { organizationId }, async (tx) => {
      await failOutbox(tx, entry.id, { error: reason.slice(0, 2000) });
      await deadLetter(tx, entry.id);
    });
    log.warn({ messageId, reason }, "email refused before the call");
    return "rejected";
  }

  const { message, command, attemptId } = prepared;

  try {
    const result = await mailer.send({
      to: [message.recipientAddress],
      subject: message.subject ?? "",
      text: message.body ?? "",
      idempotencyKey: message.dedupKey,
    });

    await withTenant(deps.db, { organizationId }, async (tx) => {
      await tx
        .update(tables.messageOutbound)
        .set({
          status: "sent",
          provider: PROVIDER,
          providerMessageId: result.id,
          errorCode: null,
          version: sql`${tables.messageOutbound.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(tables.messageOutbound.id, message.id));
      if (command && attemptId) {
        await finishCommandAttempt(tx, attemptId, "success");
        await transitionCommand(tx, command.id, "sent", "confirmed", command.version);
      }
      await completeOutbox(tx, entry.id, "confirmed");
    });
    return "sent";
  } catch (error) {
    const appError = toAppError(error);
    const detail = `${appError.code}: ${appError.message}`.slice(0, 2000);
    const unknown = appError.code === "RESULT_UNKNOWN";
    const terminal = terminalCodes.has(appError.code);

    await withTenant(deps.db, { organizationId }, async (tx) => {
      await tx
        .update(tables.messageOutbound)
        .set({
          // MSG-01: a technical reception is not a proof of reading, and a lost
          // response is not a failure — `unknown` says exactly that.
          status: unknown ? "unknown" : terminal ? "failed" : "queued",
          errorCode: appError.code,
          version: sql`${tables.messageOutbound.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(tables.messageOutbound.id, message.id));

      if (command && attemptId) {
        await finishCommandAttempt(tx, attemptId, unknown ? "unknown" : "failure", {
          responseExcerpt: detail,
        });
        await transitionCommand(
          tx,
          command.id,
          "sent",
          unknown ? "unknown_result" : terminal ? "rejected" : "authorized",
          command.version,
          {
            errorType: terminal
              ? "validation"
              : unknown
                ? "unknown_result"
                : "provider_unavailable",
            errorDetail: detail,
          },
        );
      }

      if (unknown) {
        await completeOutbox(tx, entry.id, "sent");
        return;
      }
      if (terminal) {
        await openException(tx, organizationId, message, appError.message);
        await failOutbox(tx, entry.id, { error: detail });
        await deadLetter(tx, entry.id);
        return;
      }
      await failOutbox(tx, entry.id, { error: detail, retryInSeconds: backoffSeconds(entry) });
    });

    if (unknown) {
      log.warn({ messageId: message.id }, "email result unknown, not re-emitted");
      return "unknown_result";
    }
    if (terminal) {
      log.warn({ messageId: message.id, code: appError.code }, "email rejected by the provider");
      return "rejected";
    }
    return "retry";
  }
}

export function backoffSeconds(entry: OutboxRow): number {
  return Math.min(3600, 60 * 2 ** Math.min(entry.attempts, 6));
}

export async function dispatchEmailOnce(
  deps: Deps,
  limit: number,
  mailer: Mailer | null = mailerFor(deps),
): Promise<JobOutcome> {
  const entries = await withoutTenant(deps.admin, (tx) =>
    claimOutbox(tx, {
      limit,
      workerId: deps.workerId,
      leaseSeconds: EMAIL_LEASE_SECONDS,
      channels: ["email"],
    }),
  );
  if (entries.length === 0) return { outcome: "idle", claimed: 0 };

  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const result = await dispatchEmailEntry(deps, entry, mailer);
    counts[result] = (counts[result] ?? 0) + 1;
  }
  return { outcome: "processed", claimed: entries.length, ...counts };
}

export const emailDispatch = defineJob({
  name: "email.dispatch",
  schema: EmailDispatchData,
  options: {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 600,
    localConcurrency: 1,
    batchSize: 1,
  },
  schedule: { cron: "* * * * *", tz: "Europe/Paris" },
  handler: (data, deps) => dispatchEmailOnce(deps, data.limit),
});
