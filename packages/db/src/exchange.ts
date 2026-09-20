import { currentCorrelation, redactValue } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { Tx } from "./client";

// integration_exchange is created by migration 0003 and is not yet part of the
// pulled Drizzle schema; the next `npm run db:pull` adds it.

export type ExchangeDirection = "inbound" | "outbound";
export type ExchangeStatus =
  | "pending"
  | "success"
  | "client_error"
  | "server_error"
  | "timeout"
  | "rejected"
  | "unknown";

export type ExchangeRow = {
  id: string;
  organization_id: string | null;
  request_id: string | null;
  correlation_id: string | null;
  command_id: string | null;
  integration: string;
  direction: ExchangeDirection;
  operation: string;
  request: unknown;
  response: unknown;
  status: ExchangeStatus;
  http_status: number | null;
  duration_ms: number | null;
  error_detail: string | null;
  created_at: string;
};

export type ExchangeInput = {
  integration: string;
  direction: ExchangeDirection;
  /** Odoo model.method, HTTP route or provider event name. */
  operation: string;
  request: unknown;
  response?: unknown;
  status?: ExchangeStatus;
  organizationId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  commandId?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  errorDetail?: string | null;
};

/** Stores the exchange with the shared redactor applied to both bodies. */
export async function recordExchange(tx: Tx, input: ExchangeInput): Promise<ExchangeRow> {
  const requestId = input.requestId ?? currentCorrelation()?.requestId ?? null;
  const rows = await tx.execute<ExchangeRow>(sql`
    INSERT INTO integration_exchange
      (organization_id, request_id, correlation_id, command_id, integration, direction,
       operation, request, response, status, http_status, duration_ms, error_detail)
    VALUES (
      ${input.organizationId ?? null}::uuid,
      ${requestId}::uuid,
      ${input.correlationId ?? requestId}::uuid,
      ${input.commandId ?? null}::uuid,
      ${input.integration},
      ${input.direction},
      ${input.operation},
      ${JSON.stringify(redactValue(input.request) ?? null)}::jsonb,
      ${input.response === undefined ? null : JSON.stringify(redactValue(input.response) ?? null)}::jsonb,
      ${input.status ?? "pending"},
      ${input.httpStatus ?? null},
      ${input.durationMs ?? null},
      ${input.errorDetail ?? null}
    )
    RETURNING *
  `);
  const row = [...rows][0];
  if (!row) throw new Error("integration_exchange insert returned no row");
  return row;
}

export type ExchangeOutcome = Pick<
  ExchangeInput,
  "response" | "status" | "httpStatus" | "durationMs" | "errorDetail"
>;

export async function completeExchange(
  tx: Tx,
  id: string,
  outcome: ExchangeOutcome,
): Promise<ExchangeRow | undefined> {
  const rows = await tx.execute<ExchangeRow>(sql`
    UPDATE integration_exchange
       SET response = ${outcome.response === undefined ? null : JSON.stringify(redactValue(outcome.response) ?? null)}::jsonb,
           status = ${outcome.status ?? "success"},
           http_status = ${outcome.httpStatus ?? null},
           duration_ms = ${outcome.durationMs ?? null},
           error_detail = ${outcome.errorDetail ?? null},
           version = version + 1,
           updated_at = now()
     WHERE id = ${id}::uuid
    RETURNING *
  `);
  return [...rows][0];
}

export async function findExchangesByRequestId(tx: Tx, requestId: string): Promise<ExchangeRow[]> {
  const rows = await tx.execute<ExchangeRow>(sql`
    SELECT * FROM integration_exchange WHERE request_id = ${requestId}::uuid ORDER BY created_at
  `);
  return [...rows];
}

/** Admin path: RLS scopes a tenant session to its own rows and hides system ones. */
export async function purgeExchanges(tx: Tx, olderThanDays = 30): Promise<number> {
  const rows = await tx.execute<{ removed: number }>(
    sql`SELECT purge_integration_exchange(${olderThanDays}) AS removed`,
  );
  return Number([...rows][0]?.removed ?? 0);
}
