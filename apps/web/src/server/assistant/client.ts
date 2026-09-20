import "server-only";
import { type AiClient, aiConfigFromEnv, createAiClient, isConfigured } from "@lfsci/ai";
import { logger } from "@lfsci/kernel";
import { env } from "../env";

const log = logger("assistant.client");

/**
 * Null when the selected provider has nothing to talk to: the route answers one
 * `error` frame instead of crashing on the first call (tech pack §7, D-04).
 * Ollama counts as configured on its base URL alone; reachability is a probe
 * (`client.health()`), never a boot-time network call.
 */
export function assistantClient(): AiClient | null {
  env();
  try {
    const config = aiConfigFromEnv();
    if (!isConfigured(config)) return null;
    return createAiClient(config);
  } catch (error) {
    log.warn({ err: error }, "assistant client unavailable");
    return null;
  }
}
