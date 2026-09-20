import { parseEnv, requiredString } from "@lfsci/kernel";
import { z } from "zod";

export const SMSMODE_BASE_URL = "https://rest.smsmode.com";
export const SMSMODE_MESSAGES_PATH = "/sms/v1/messages";
// Header name read from the smsmode REST SMS API docs on 2026-09-20: TO CONFIRM with an account key.
export const SMSMODE_API_KEY_HEADER = "X-Api-Key";
// French sender-ID rules since 2026-03-01: an alphanumeric sender is one-way, so replies need a long code.
export const ALPHANUMERIC_SENDER_IS_ONE_WAY_SINCE = "2026-03-01";

export const SmsConfig = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.url().default(SMSMODE_BASE_URL),
  sender: z.string().min(1),
  senderIsLongCode: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(15_000),
});
export type SmsConfig = z.infer<typeof SmsConfig>;

export function smsConfigFromEnv(source: NodeJS.ProcessEnv = process.env): SmsConfig {
  const env = parseEnv(
    {
      SMSMODE_API_KEY: requiredString,
      SMSMODE_BASE_URL: z.url().default(SMSMODE_BASE_URL),
      SMSMODE_SENDER: requiredString,
      SMSMODE_SENDER_IS_LONG_CODE: z.stringbool().default(false),
      SMSMODE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    },
    source,
  );
  return SmsConfig.parse({
    apiKey: env.SMSMODE_API_KEY,
    baseUrl: env.SMSMODE_BASE_URL,
    sender: env.SMSMODE_SENDER,
    senderIsLongCode: env.SMSMODE_SENDER_IS_LONG_CODE,
    timeoutMs: env.SMSMODE_TIMEOUT_MS,
  });
}
