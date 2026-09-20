import { parseEnv, requiredString } from "@lfsci/kernel";
import { z } from "zod";

// Gladia v2, verified 2026-09-19: single production host, auth header x-gladia-key.
export const GLADIA_DEFAULT_BASE_URL = "https://api.gladia.io";
export const GLADIA_UPLOAD_PATH = "/v2/upload";
export const GLADIA_PRERECORDED_PATH = "/v2/pre-recorded";
export const GLADIA_API_KEY_HEADER = "x-gladia-key";
// No regional base URL or region field is documented on /v2/pre-recorded (checked 2026-09-20): unverified.
export const GLADIA_REGION_SUPPORT = "unverified" as const;

export const SpeechConfig = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.url().default(GLADIA_DEFAULT_BASE_URL),
  language: z.string().min(2).default("fr"),
  timeoutMs: z.number().int().positive().default(60_000),
  pollIntervalMs: z.number().int().positive().default(2_000),
  maxWaitMs: z.number().int().positive().default(600_000),
});
export type SpeechConfig = z.infer<typeof SpeechConfig>;

export function speechConfigFromEnv(source: NodeJS.ProcessEnv = process.env): SpeechConfig {
  const env = parseEnv(
    {
      GLADIA_API_KEY: requiredString,
      GLADIA_BASE_URL: z.url().default(GLADIA_DEFAULT_BASE_URL),
      GLADIA_LANGUAGE: z.string().min(2).default("fr"),
      GLADIA_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
      GLADIA_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
      GLADIA_MAX_WAIT_MS: z.coerce.number().int().positive().default(600_000),
    },
    source,
  );
  return SpeechConfig.parse({
    apiKey: env.GLADIA_API_KEY,
    baseUrl: env.GLADIA_BASE_URL,
    language: env.GLADIA_LANGUAGE,
    timeoutMs: env.GLADIA_TIMEOUT_MS,
    pollIntervalMs: env.GLADIA_POLL_INTERVAL_MS,
    maxWaitMs: env.GLADIA_MAX_WAIT_MS,
  });
}
