import "server-only";
import { aiConfigFromEnv, checkOllama } from "@lfsci/ai";
import type { ComponentStatus } from "@/lib/contract";
import { ReadyResult } from "@/lib/contract";
import { sql } from "../../db";
import { env } from "../../env";
import { pub, validated } from "../base";

export async function databaseStatus(): Promise<ComponentStatus> {
  try {
    await sql()`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}

/** A readiness probe must not reach the GPU box on every request. */
export const MODEL_STATUS_TTL_MS = 30_000;
export const MODEL_PROBE_TIMEOUT_MS = 2_000;

let modelCache: { at: number; status: ComponentStatus } | undefined;

async function probeModel(): Promise<ComponentStatus> {
  const config = aiConfigFromEnv();
  if (config.AI_PROVIDER !== "ollama") return "unknown";
  const health = await checkOllama({
    baseUrl: config.OLLAMA_BASE_URL,
    modelText: config.OLLAMA_MODEL_TEXT,
    modelVision: config.OLLAMA_MODEL_VISION,
    modelEmbed: config.OLLAMA_MODEL_EMBED,
    apiKey: config.OLLAMA_API_KEY,
    timeoutMs: MODEL_PROBE_TIMEOUT_MS,
  });
  return health.reachable && health.missing.length === 0 ? "up" : "down";
}

/**
 * `down` never makes the application unready: rent, documents and Odoo keep
 * working without the model, and the Accueil banner says so in French.
 */
export async function modelStatus(): Promise<ComponentStatus> {
  const now = Date.now();
  if (modelCache && now - modelCache.at < MODEL_STATUS_TTL_MS) return modelCache.status;
  let status: ComponentStatus;
  try {
    env();
    status = await probeModel();
  } catch {
    status = "unknown";
  }
  modelCache = { at: now, status };
  return status;
}

export const health = {
  ready: pub.health.ready.use(validated(ReadyResult)).handler(async ({ context }) => {
    const database = await databaseStatus();
    const model = await modelStatus();
    return {
      status: database === "up" ? ("ready" as const) : ("degraded" as const),
      requestId: context.requestId,
      // storage and queue arrive with the integrations and the worker.
      components: { database, storage: "unknown" as const, queue: "unknown" as const, model },
    };
  }),
};
