import { AsyncLocalStorage } from "node:async_hooks";
import type { DbHandle, ExchangeStatus } from "@lfsci/db";
import { recordExchange, withTenant } from "@lfsci/db";
import { logger } from "@lfsci/kernel";
import type { ExchangeRecorder } from "@lfsci/odoo";

const log = logger("worker.exchange");

export type ExchangeContext = { organizationId: string; commandId: string | null };

const storage = new AsyncLocalStorage<ExchangeContext>();

export function withExchangeContext<T>(context: ExchangeContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

function statusOf(httpStatus: number | null): ExchangeStatus {
  if (httpStatus === null) return "timeout";
  if (httpStatus < 400) return "success";
  if (httpStatus < 500) return "client_error";
  return "server_error";
}

/**
 * The Odoo client is built once at boot, so the tenant and command an exchange
 * belongs to travel in async context rather than in the client's config.
 */
export function createDbExchangeRecorder(handle: DbHandle): ExchangeRecorder {
  return {
    async record(exchange) {
      const context = storage.getStore();
      if (!context) {
        log.debug({ model: exchange.model }, "exchange outside a tenant context, not persisted");
        return;
      }
      await withTenant(handle, { organizationId: context.organizationId }, (tx) =>
        recordExchange(tx, {
          integration: "odoo",
          direction: "outbound",
          operation: `${exchange.model}.${exchange.method}`,
          request: exchange.request,
          response: exchange.response,
          status: statusOf(exchange.status),
          organizationId: context.organizationId,
          commandId: context.commandId,
          requestId: exchange.requestId,
          httpStatus: exchange.status,
          durationMs: Math.round(exchange.durationMs),
        }),
      );
    },
  };
}
