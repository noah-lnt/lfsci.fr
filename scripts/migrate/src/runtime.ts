import { createDb, type DbHandle } from "@lfsci/db";
import type { OdooClient } from "@lfsci/odoo";
import { createOdooClient } from "@lfsci/odoo";
import { requireEnv } from "./cli";

/** Reads only: the migration never posts anything to Odoo, so no rate budget applies. */
export function odooClientFromEnv(env: NodeJS.ProcessEnv = process.env): OdooClient {
  return createOdooClient({
    baseUrl: requireEnv("ODOO_BASE_URL", env),
    apiKey: requireEnv("ODOO_API_KEY", env),
    database: requireEnv("ODOO_DATABASE", env),
    login: env.ODOO_LOGIN ?? "",
    transport: env.ODOO_TRANSPORT === "json2" ? "json2" : "jsonrpc",
    ratePerSecond: Number(env.ODOO_MIGRATE_RATE ?? env.ODOO_RATE_LIMIT_PER_SECOND ?? 1),
    timeoutMs: Number(env.ODOO_MIGRATE_TIMEOUT_MS ?? 30_000),
  });
}

export function dbFromEnv(env: NodeJS.ProcessEnv = process.env): DbHandle {
  return createDb({ url: requireEnv("DATABASE_URL", env), max: 2, connectTimeoutSeconds: 5 });
}
