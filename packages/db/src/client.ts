import { parseEnv, requiredString } from "@lfsci/kernel";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as relations from "./generated/relations";
import * as tables from "./generated/schema";

export const schema = { ...tables, ...relations };
export type Schema = typeof schema;

export type Db = PostgresJsDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export const DEFAULT_APP_ROLE = "lfsci_app";

export type DbConfig = {
  url: string;
  max?: number;
  /** Role assumed by withTenant so RLS applies; null disables the switch. */
  appRole?: string | null;
  applicationName?: string;
  /** postgres.js prepared statements; off by default so a transaction pooler stays usable. */
  prepare?: boolean;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
};

export type DbHandle = {
  sql: Sql;
  db: Db;
  appRole: string | null;
  close: () => Promise<void>;
};

export function createDb(config: DbConfig): DbHandle {
  const sql = postgres(config.url, {
    max: config.max ?? 10,
    prepare: config.prepare ?? false,
    onnotice: () => {},
    idle_timeout: config.idleTimeoutSeconds ?? 30,
    connect_timeout: config.connectTimeoutSeconds ?? 10,
    connection: { application_name: config.applicationName ?? "lfsci" },
  });
  const db = drizzle(sql, { schema });
  return {
    sql,
    db,
    appRole: config.appRole === undefined ? DEFAULT_APP_ROLE : config.appRole,
    close: () => sql.end({ timeout: 5 }),
  };
}

const envShape = {
  DATABASE_URL: requiredString,
  DATABASE_ADMIN_URL: requiredString,
};

export type DbRole = "app" | "admin";

export function dbFromEnv(role: DbRole = "app", overrides: Partial<DbConfig> = {}): DbHandle {
  const env = parseEnv(envShape);
  const url = role === "admin" ? env.DATABASE_ADMIN_URL : env.DATABASE_URL;
  return createDb({ url, ...overrides });
}
