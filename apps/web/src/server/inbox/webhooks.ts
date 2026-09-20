import "server-only";
import type { Tx } from "@lfsci/db";
import { recordExchange, withTenant } from "@lfsci/db";
import { AppError, logger } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import { appDb } from "../data";

const log = logger("inbox.webhook");

/**
 * INT-01: an inbound webhook carries no tenant. With one active organization the
 * mapping is unambiguous; with several it must be configured, so the message is
 * refused rather than filed under a guess.
 */
export async function resolveWebhookOrganization(): Promise<string> {
  const rows = await appDb().sql<
    { id: string }[]
  >`SELECT id FROM organization WHERE status = 'active' ORDER BY code`;
  const first = rows[0];
  if (!first) throw new AppError("NOT_FOUND", { message: "no active organization" });
  if (rows.length > 1) {
    throw new AppError("AMBIGUOUS_REFERENCE", {
      message: "several active organizations; inbound routing is not configured",
    });
  }
  return first.id;
}

export function inTenant<T>(
  organizationId: string,
  requestId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(appDb(), { organizationId, requestId }, fn);
}

/** True when this provider id was already ingested; the dedup happens before any effect. */
export async function alreadySeen(tx: Tx, channel: string, providerId: string): Promise<boolean> {
  const rows = [
    ...(await tx.execute<{ id: string }>(sql`
      SELECT id FROM activity WHERE channel = ${channel} AND external_id = ${providerId}
       UNION ALL
      SELECT id FROM inbox_item WHERE source_reference = ${providerId}
       LIMIT 1`)),
  ];
  return rows.length > 0;
}

/** INT-01: an invalid message is parked; its content never reaches a log line. */
export async function quarantine(
  tx: Tx,
  organizationId: string,
  input: { source: string; providerId: string | null; reason: string },
): Promise<void> {
  log.warn(
    { source: input.source, providerId: input.providerId, reason: input.reason },
    "inbound message quarantined",
  );
  await tx.execute(sql`
    INSERT INTO inbox_item (organization_id, source, source_reference, status, rejected_reason)
    VALUES (${organizationId}::uuid, ${input.source}, ${input.providerId},
            'quarantined', ${input.reason})`);
}

export async function logExchange(
  tx: Tx,
  input: {
    organizationId: string;
    requestId: string;
    integration: string;
    operation: string;
    request: unknown;
    status: "success" | "rejected" | "client_error";
    httpStatus: number;
  },
): Promise<void> {
  await recordExchange(tx, {
    integration: input.integration,
    direction: "inbound",
    operation: input.operation,
    request: input.request,
    status: input.status,
    httpStatus: input.httpStatus,
    organizationId: input.organizationId,
    requestId: input.requestId,
  });
}
