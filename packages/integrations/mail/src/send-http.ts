import { AppError, logger } from "@lfsci/kernel";
import { z } from "zod";
import type { MailConfig } from "./config";
import {
  type FetchLike,
  mapHttpFailure,
  mapTransportFailure,
  parseUpstream,
  readBody,
} from "./http";
import { type Mailer, OutboundEmail } from "./send";

const SERVICE = "resend";
const log = logger(SERVICE);

export const RESEND_SEND_EMAIL_PATH = "/emails";

const SendResponse = z.object({ id: z.string().min(1) });

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Same contract as `createMailer`, over the REST endpoint with an injected
 * fetch, so the worker exercises it against a fake and never links the SDK.
 * The idempotency key is the message's dedup key: a retry after a lost response
 * is the provider's problem to deduplicate, not ours to guess.
 */
export function createHttpMailer(input: { config: MailConfig; fetch?: FetchLike }): Mailer {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;

  return {
    async send(email) {
      const parsed = OutboundEmail.safeParse(email);
      if (!parsed.success) {
        throw new AppError("VALIDATION", {
          message: "invalid outbound email",
          details: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
        });
      }
      const payload = parsed.data;
      const replyTo = payload.replyTo ?? config.replyTo;
      const body = {
        from: config.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(payload.attachments
          ? {
              attachments: payload.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: base64(attachment.content),
              })),
            }
          : {}),
      };

      let response: Response;
      try {
        response = await doFetch(`${config.baseUrl}${RESEND_SEND_EMAIL_PATH}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
            ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (cause) {
        throw mapTransportFailure({
          service: SERVICE,
          idempotent: payload.idempotencyKey !== undefined,
          cause,
        });
      }

      if (!response.ok) {
        throw mapHttpFailure({
          service: SERVICE,
          status: response.status,
          body: await readBody(response),
        });
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (cause) {
        throw new AppError("RESULT_UNKNOWN", {
          message: "resend answered without a readable body",
          details: { service: SERVICE },
          cause,
        });
      }
      const result = parseUpstream(SendResponse, data, SERVICE);
      log.debug({ emailId: result.id }, "email sent");
      return { id: result.id };
    },
  };
}
