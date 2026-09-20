import "server-only";
import { type AiClient, aiConfigFromEnv, createAiClient } from "@lfsci/ai";
import { logger } from "@lfsci/kernel";
import { env } from "../env";

const log = logger("assistant.client");

/**
 * Null when no credentials are configured: the route answers one `error` frame
 * instead of crashing on the first call (tech pack §7, D-04).
 */
export function assistantClient(): AiClient | null {
  env();
  try {
    const config = aiConfigFromEnv();
    if (config.AI_PROVIDER === "anthropic" && !config.ANTHROPIC_API_KEY) return null;
    if (
      config.AI_PROVIDER === "bedrock" &&
      !process.env.AWS_ACCESS_KEY_ID &&
      !process.env.AWS_PROFILE &&
      !process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI &&
      !process.env.AWS_WEB_IDENTITY_TOKEN_FILE
    ) {
      return null;
    }
    return createAiClient(config);
  } catch (error) {
    log.warn({ err: error }, "assistant client unavailable");
    return null;
  }
}
