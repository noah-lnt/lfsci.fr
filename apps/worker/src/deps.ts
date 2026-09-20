import { type AiClient, createAiClient } from "@lfsci/ai";
import { createDb, type DbHandle } from "@lfsci/db";
import { createInboundReader, type InboundReader, mailConfigFromEnv } from "@lfsci/mail";
import { createOcrClient, type OcrClient, ocrConfigFromEnv } from "@lfsci/ocr";
import {
  createOdooClient,
  createOdooOperations,
  type ExchangeRecorder,
  type OdooClient,
  type OdooOperations,
} from "@lfsci/odoo";
import { createInseeClient, type InseeClient, openDataConfigFromEnv } from "@lfsci/opendata";
import { createSpeechClient, type SpeechClient, speechConfigFromEnv } from "@lfsci/speech";
import { createStorage, type Storage, storageConfigFromEnv } from "@lfsci/storage";
import type { PgBoss } from "pg-boss";
import { configuredVendors, type WorkerEnv } from "./env";

export type OdooPort = {
  client: OdooClient;
  operations: OdooOperations;
  database: string;
  /** Wall-clock budget after which a lost response can no longer be executing (SYN-03). */
  timeoutMs: number;
};

/**
 * Ports the jobs use. Every vendor is nullable so a handler can answer
 * `sources_unavailable` instead of retrying against a client that cannot exist.
 */
export type Deps = {
  env: WorkerEnv;
  workerId: string;
  /** Application handle: withTenant switches it to lfsci_app so RLS applies. */
  db: DbHandle;
  /** Owner handle: cross-organization loops, purges, outbox lease reaping. */
  admin: DbHandle;
  boss: Pick<PgBoss, "send" | "sendAfter">;
  now: () => Date;
  odoo: OdooPort | null;
  storage: Storage | null;
  ocr: OcrClient | null;
  speech: SpeechClient | null;
  ai: AiClient | null;
  mail: InboundReader | null;
  insee: InseeClient | null;
};

export type DepsOverrides = Partial<Omit<Deps, "env" | "db" | "admin" | "boss">>;

export function buildDeps(input: {
  env: WorkerEnv;
  db: DbHandle;
  admin: DbHandle;
  boss: Pick<PgBoss, "send" | "sendAfter">;
  recorder?: ExchangeRecorder;
}): Deps {
  const { env } = input;
  const vendors = configuredVendors(env);

  let odoo: OdooPort | null = null;
  if (vendors.odoo && env.ODOO_BASE_URL && env.ODOO_API_KEY) {
    const timeoutMs = 30_000;
    const client = createOdooClient({
      baseUrl: env.ODOO_BASE_URL,
      apiKey: env.ODOO_API_KEY,
      database: env.ODOO_DATABASE,
      ratePerSecond: env.ODOO_RATE_LIMIT_PER_SECOND,
      timeoutMs,
      recorder: input.recorder,
    });
    odoo = {
      client,
      operations: createOdooOperations(client),
      database: env.ODOO_DATABASE ?? "unknown",
      timeoutMs,
    };
  }

  return {
    env,
    workerId: env.WORKER_ID,
    db: input.db,
    admin: input.admin,
    boss: input.boss,
    now: () => new Date(),
    odoo,
    storage: vendors.storage ? createStorage({ config: storageConfigFromEnv() }) : null,
    ocr: vendors.ocr ? createOcrClient({ config: ocrConfigFromEnv() }) : null,
    speech: vendors.speech ? createSpeechClient({ config: speechConfigFromEnv() }) : null,
    ai: vendors.ai
      ? createAiClient({
          AI_PROVIDER: "bedrock",
          AI_MODEL: "claude-opus-5",
          AWS_REGION: process.env.AWS_REGION ?? "eu-west-3",
        })
      : null,
    mail: vendors.mail ? createInboundReader({ config: mailConfigFromEnv() }) : null,
    insee: createInseeClient({ config: openDataConfigFromEnv() }),
  };
}

export function createHandles(env: WorkerEnv): { db: DbHandle; admin: DbHandle } {
  return {
    db: createDb({ url: env.DATABASE_URL, max: 8, applicationName: "lfsci-worker" }),
    admin: createDb({
      url: env.DATABASE_ADMIN_URL,
      max: 2,
      appRole: null,
      applicationName: "lfsci-worker-admin",
    }),
  };
}
