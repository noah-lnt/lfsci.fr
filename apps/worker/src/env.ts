import { hostname } from "node:os";
import { DEFAULT_EMBED_DIMENSIONS, DEFAULT_OLLAMA_MODEL_EMBED } from "@lfsci/ai";
import { parseEnv, requiredString } from "@lfsci/kernel";
import { z } from "zod";

/**
 * `.env` and `.env.example` declare an unused vendor key as an empty string, so
 * blank has to read as absent: the worker must boot with no vendor at all and
 * report `sources_unavailable` on the jobs that need one (spec SYN-06).
 */
const blankIsAbsent = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optional = z.preprocess(blankIsAbsent, z.string().trim().min(1).optional());
const optionalNumber = z.preprocess(blankIsAbsent, z.coerce.number().int().positive().optional());
const optionalProvider = z.preprocess(
  blankIsAbsent,
  z.enum(["ollama", "anthropic", "bedrock"]).optional(),
);
const textOr = (fallback: string) =>
  z.preprocess(blankIsAbsent, z.string().trim().min(1).default(fallback));
const numberOr = (fallback: number) =>
  z.preprocess(blankIsAbsent, z.coerce.number().int().positive().default(fallback));
const shape = {
  DATABASE_URL: requiredString,
  DATABASE_ADMIN_URL: requiredString,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SENTRY_DSN: optional,
  WORKER_ID: optional,
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9090),
  PGBOSS_SCHEMA: z.string().trim().min(1).default("pgboss"),
  MIGRATIONS_DIR: optional,

  ODOO_BASE_URL: optional,
  ODOO_DATABASE: optional,
  ODOO_API_KEY: optional,
  ODOO_RATE_LIMIT_PER_SECOND: z.coerce.number().positive().default(1),

  // Chart accounts, by code. Empty falls back to the codes measured in Phase 0;
  // none of them is confirmed by the accountant (docs/QUESTIONS.md item 8b).
  ODOO_ACCOUNT_RENT: optional,
  ODOO_ACCOUNT_CHARGES: optional,
  ODOO_ACCOUNT_ACCESSORIES: optional,
  ODOO_ACCOUNT_DEPOSIT: optional,
  ODOO_ACCOUNT_CCA: optional,
  ODOO_ACCOUNT_CCA_COUNTERPART: optional,
  ODOO_ACCOUNT_RECEIVABLE: optional,
  ODOO_ANALYTIC_PLAN_ID: optionalNumber,

  STORAGE_BUCKET: optional,
  STORAGE_ACCESS_KEY_ID: optional,
  STORAGE_SECRET_ACCESS_KEY: optional,

  MISTRAL_API_KEY: optional,
  GLADIA_API_KEY: optional,
  RESEND_API_KEY: optional,
  RESEND_FROM: optional,
  RESEND_WEBHOOK_SECRET: optional,
  SMSMODE_API_KEY: optional,
  SMSMODE_SENDER: optional,
  AI_PROVIDER: optionalProvider,
  ANTHROPIC_API_KEY: optional,
  AWS_ACCESS_KEY_ID: optional,
  OLLAMA_BASE_URL: optional,
  OLLAMA_MODEL_TEXT: optional,
  OLLAMA_MODEL_VISION: optional,
  OLLAMA_MODEL_EMBED: textOr(DEFAULT_OLLAMA_MODEL_EMBED),
  // `embedding.vector` is vector(1024) in migration 0001: another width is a column migration.
  AI_EMBED_DIMENSIONS: numberOr(DEFAULT_EMBED_DIMENSIONS),
  OLLAMA_TIMEOUT_MS: optional,
  OLLAMA_API_KEY: optional,

  TYPST_BINARY: optional,
  TEMPLATES_DIR: optional,
};

export type WorkerEnv = z.infer<z.ZodObject<typeof shape>> & { WORKER_ID: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const env = parseEnv(shape, source);
  return { ...env, WORKER_ID: env.WORKER_ID ?? `${hostname()}-${process.pid}` };
}

export type VendorName = "odoo" | "storage" | "ocr" | "speech" | "mail" | "sms" | "ai";

/**
 * A vendor is "configured" only when the variables its client factory requires
 * are all present; a half-filled block reads as absent, never as a boot failure.
 */
export function configuredVendors(env: WorkerEnv): Record<VendorName, boolean> {
  return {
    odoo: Boolean(env.ODOO_BASE_URL && env.ODOO_API_KEY),
    storage: Boolean(
      env.STORAGE_BUCKET && env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY,
    ),
    ocr: Boolean(env.MISTRAL_API_KEY),
    speech: Boolean(env.GLADIA_API_KEY),
    mail: Boolean(env.RESEND_API_KEY && env.RESEND_FROM && env.RESEND_WEBHOOK_SECRET),
    sms: Boolean(env.SMSMODE_API_KEY && env.SMSMODE_SENDER),
    ai:
      env.AI_PROVIDER === "ollama" ? true : Boolean(env.ANTHROPIC_API_KEY || env.AWS_ACCESS_KEY_ID),
  };
}
