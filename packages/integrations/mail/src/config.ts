import { parseEnv, requiredString } from "@lfsci/kernel";
import { z } from "zod";

export const RESEND_API_BASE_URL = "https://api.resend.com";
// Receiving API paths are inferred from the inbound guide: TO CONFIRM against the Resend docs.
export const RESEND_RECEIVING_EMAIL_PATH = "/emails/receiving";
export const SVIX_TOLERANCE_SECONDS = 300;

export const MailConfig = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.url().default(RESEND_API_BASE_URL),
  from: z.email(),
  replyTo: z.email().optional(),
  webhookSecret: z.string().min(1),
  timeoutMs: z.number().int().positive().default(20_000),
});
export type MailConfig = z.infer<typeof MailConfig>;

export function mailConfigFromEnv(source: NodeJS.ProcessEnv = process.env): MailConfig {
  const env = parseEnv(
    {
      RESEND_API_KEY: requiredString,
      RESEND_BASE_URL: z.url().default(RESEND_API_BASE_URL),
      RESEND_FROM: z.email(),
      RESEND_REPLY_TO: z.email().optional(),
      RESEND_WEBHOOK_SECRET: requiredString,
      RESEND_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    },
    source,
  );
  return MailConfig.parse({
    apiKey: env.RESEND_API_KEY,
    baseUrl: env.RESEND_BASE_URL,
    from: env.RESEND_FROM,
    ...(env.RESEND_REPLY_TO ? { replyTo: env.RESEND_REPLY_TO } : {}),
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
    timeoutMs: env.RESEND_TIMEOUT_MS,
  });
}
