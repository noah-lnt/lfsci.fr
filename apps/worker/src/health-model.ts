import { aiConfigFromEnv, checkOllama, type OllamaHealth } from "@lfsci/ai";
import { logger } from "@lfsci/kernel";

const log = logger("worker.health.model");

/** A probe every 30 s at most: a liveness check must not load the GPU box. */
export const MODEL_PROBE_TTL_MS = 30_000;

export type ModelStatus = "up" | "down" | "unknown";

export type ModelComponent = {
  status: ModelStatus;
  provider: string;
  missingModels: string[];
  detail: string | null;
  checkedAt: string | null;
};

/** `null` means the selected provider exposes no reachability check. */
export type ModelProbe = () => Promise<OllamaHealth | null>;

export const UNKNOWN_MODEL: ModelComponent = {
  status: "unknown",
  provider: "unknown",
  missingModels: [],
  detail: null,
  checkedAt: null,
};

export function statusOf(health: OllamaHealth | null): ModelStatus {
  if (!health) return "unknown";
  if (!health.reachable) return "down";
  return health.missing.length === 0 ? "up" : "down";
}

export async function probeConfiguredProvider(): Promise<OllamaHealth | null> {
  const config = aiConfigFromEnv();
  if (config.AI_PROVIDER !== "ollama") return null;
  return checkOllama({
    baseUrl: config.OLLAMA_BASE_URL,
    modelText: config.OLLAMA_MODEL_TEXT,
    modelVision: config.OLLAMA_MODEL_VISION,
    modelEmbed: config.OLLAMA_MODEL_EMBED,
    apiKey: config.OLLAMA_API_KEY,
  });
}

export function providerName(): string {
  try {
    return aiConfigFromEnv().AI_PROVIDER;
  } catch {
    return "unknown";
  }
}

export type ModelHealth = { read: () => Promise<ModelComponent> };

/**
 * Caches the last answer for a TTL and never rejects: the model being down is a
 * component state, not a worker failure (spec SYN-06).
 */
export function createModelHealth(
  probe: ModelProbe = probeConfiguredProvider,
  options: { ttlMs?: number; now?: () => Date; provider?: () => string } = {},
): ModelHealth {
  const ttlMs = options.ttlMs ?? MODEL_PROBE_TTL_MS;
  const now = options.now ?? (() => new Date());
  const name = options.provider ?? providerName;
  let cached: { at: number; value: ModelComponent } | null = null;
  let inFlight: Promise<ModelComponent> | null = null;

  async function run(): Promise<ModelComponent> {
    let component: ModelComponent;
    try {
      const health = await probe();
      component = {
        status: statusOf(health),
        provider: name(),
        missingModels: health?.missing ?? [],
        detail: health?.detail ?? null,
        checkedAt: now().toISOString(),
      };
    } catch (error) {
      log.warn({ err: error }, "model probe failed");
      component = {
        ...UNKNOWN_MODEL,
        status: "down",
        provider: name(),
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: now().toISOString(),
      };
    }
    cached = { at: now().getTime(), value: component };
    return component;
  }

  return {
    read: async () => {
      if (cached && now().getTime() - cached.at < ttlMs) return cached.value;
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
