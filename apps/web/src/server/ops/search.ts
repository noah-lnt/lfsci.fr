import "server-only";
import { CommandState } from "@lfsci/contracts";
import { findExchangesByRequestId } from "@lfsci/db";
import { sql } from "drizzle-orm";
import type { OpsIntegrationsResult, OpsQueuesResult, OpsSearchResult } from "@/lib/contracts/ops";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { jobCounts, jobsByRequestId } from "./queue-tables";

function instant(column: string): ReturnType<typeof sql> {
  return sql.raw(`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00')`);
}

/** OPS-01: one correlation id, every trace it left, before opening a log. */
export async function searchByRequestId(
  scope: TenantScope,
  requestId: string,
): Promise<OpsSearchResult> {
  const jobs = await jobsByRequestId(requestId);

  return tenant(scope, async (tx) => {
    const commands = [
      ...(await tx.execute<{
        id: string;
        version: number;
        command_type: string;
        operation_key: string;
        payload_hash: string;
        status: string;
        autonomy_level: "A" | "B" | "C" | "D";
        error_type: string | null;
        error_detail: string | null;
        correlation_id: string;
        created_at: string;
        updated_at: string | null;
      }>(sql`
        SELECT id, version, command_type, operation_key, payload_hash, status, autonomy_level,
               error_type, error_detail, correlation_id,
               ${instant("created_at")} AS created_at,
               ${instant("updated_at")} AS updated_at
          FROM command WHERE correlation_id = ${requestId}::uuid
         ORDER BY created_at LIMIT 100`)),
    ];

    const attempts = [
      ...(await tx.execute<{
        id: string;
        command_id: string;
        attempt_number: number;
        step: string;
        outcome: string;
        http_status: number | null;
        provider_fault: string | null;
        created_at: string;
        finished_at: string | null;
      }>(sql`
        SELECT a.id, a.command_id, a.attempt_number, a.step, a.outcome, a.http_status,
               a.provider_fault,
               ${instant("a.created_at")} AS created_at,
               ${instant("a.finished_at")} AS finished_at
          FROM command_attempt a JOIN command c ON c.id = a.command_id
         WHERE c.correlation_id = ${requestId}::uuid
         ORDER BY a.attempt_number LIMIT 200`)),
    ];

    const exchanges = await findExchangesByRequestId(tx, requestId);

    return {
      requestId,
      commands: commands.map((row) => ({
        id: row.id,
        version: row.version,
        commandType: row.command_type,
        operationKey: row.operation_key,
        payloadHash: row.payload_hash,
        status: CommandState.parse(row.status),
        autonomyLevel: row.autonomy_level,
        errorType: row.error_type,
        errorDetail: row.error_detail,
        correlationId: row.correlation_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      attempts: attempts.map((row) => ({
        id: row.id,
        commandId: row.command_id,
        attemptNumber: row.attempt_number,
        step: row.step,
        outcome: row.outcome,
        httpStatus: row.http_status,
        providerFault: row.provider_fault,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
      })),
      exchanges: exchanges.map((row) => ({
        id: row.id,
        integration: row.integration,
        direction: row.direction,
        operation: row.operation,
        status: row.status,
        httpStatus: row.http_status,
        durationMs: row.duration_ms,
        errorDetail: row.error_detail,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      jobs: jobs.rows,
      queueAvailable: jobs.available,
    };
  });
}

export async function queueStats(scope: TenantScope): Promise<OpsQueuesResult> {
  const jobs = await jobCounts();

  return tenant(scope, async (tx) => {
    const outbox = [
      ...(await tx.execute<{ status: string; count: string }>(
        sql`SELECT status, count(*)::text AS count FROM outbox_entry GROUP BY status ORDER BY status`,
      )),
    ];
    const commands = [
      ...(await tx.execute<{ status: string; count: string }>(
        sql`SELECT status, count(*)::text AS count FROM command GROUP BY status ORDER BY status`,
      )),
    ];
    return {
      available: jobs.available,
      queues: jobs.rows.map((row) => ({ name: row.name, state: row.state, count: row.count })),
      outbox: outbox.map((row) => ({ status: row.status, count: Number(row.count) })),
      commands: commands.map((row) => ({
        status: CommandState.parse(row.status),
        count: Number(row.count),
      })),
    };
  });
}

export async function integrationHealth(scope: TenantScope): Promise<OpsIntegrationsResult> {
  return tenant(scope, async (tx) => {
    const rows = [
      ...(await tx.execute<{
        connector: string;
        stream: string;
        health: OpsIntegrationsResult["integrations"][number]["health"];
        cursor_value: string | null;
        last_success_at: string | null;
        last_attempt_at: string | null;
        last_error: string | null;
        consecutive_failures: number;
        last_exchange_at: string | null;
        last_exchange_status: string | null;
      }>(sql`
        SELECT c.connector, c.stream, c.health, c.cursor_value,
               ${instant("c.last_success_at")} AS last_success_at,
               ${instant("c.last_attempt_at")} AS last_attempt_at,
               c.last_error, c.consecutive_failures,
               ${instant("e.created_at")} AS last_exchange_at,
               e.status AS last_exchange_status
          FROM integration_cursor c
          LEFT JOIN LATERAL (
                 SELECT created_at, status FROM integration_exchange x
                  WHERE x.integration = c.connector ORDER BY x.created_at DESC LIMIT 1) e ON TRUE
         ORDER BY c.connector, c.stream`)),
    ];
    return {
      integrations: rows.map((row) => ({
        connector: row.connector,
        stream: row.stream,
        health: row.health,
        cursorValue: row.cursor_value,
        lastSuccessAt: row.last_success_at,
        lastAttemptAt: row.last_attempt_at,
        lastError: row.last_error,
        consecutiveFailures: row.consecutive_failures,
        lastExchangeAt: row.last_exchange_at,
        lastExchangeStatus: row.last_exchange_status,
      })),
    };
  });
}
