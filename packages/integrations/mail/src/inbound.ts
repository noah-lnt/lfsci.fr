import { z } from "zod";
import type { MailConfig } from "./config";
import { RESEND_RECEIVING_EMAIL_PATH } from "./config";
import {
  type FetchLike,
  mapHttpFailure,
  mapTransportFailure,
  parseUpstream,
  readBody,
} from "./http";

const SERVICE = "resend-receiving";

export const InboundEvent = z.object({
  type: z.literal("email.received"),
  created_at: z.string(),
  data: z.object({
    email_id: z.string().min(1),
    from: z.string(),
    to: z.array(z.string()),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    subject: z.string().optional(),
    created_at: z.string().optional(),
  }),
});
export type InboundEvent = z.infer<typeof InboundEvent>;

export const InboundEmail = z.object({
  id: z.string().min(1),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string().optional(),
  text: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        filename: z.string(),
        content_type: z.string().optional(),
        size: z.number().int().optional(),
      }),
    )
    .optional(),
});
export type InboundEmail = z.infer<typeof InboundEmail>;

export function parseInboundEvent(payload: unknown): InboundEvent {
  return parseUpstream(InboundEvent, payload, SERVICE);
}

export type InboundReader = {
  getInboundEmail(emailId: string): Promise<InboundEmail>;
  getInboundAttachment(emailId: string, attachmentId: string): Promise<Uint8Array>;
};

export function createInboundReader(input: {
  config: MailConfig;
  fetch?: FetchLike;
}): InboundReader {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;

  async function get(path: string): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${config.baseUrl}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json" },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (cause) {
      throw mapTransportFailure({ service: SERVICE, idempotent: true, cause });
    }
    if (!response.ok) {
      throw mapHttpFailure({
        service: SERVICE,
        status: response.status,
        body: await readBody(response),
      });
    }
    return response;
  }

  return {
    async getInboundEmail(emailId) {
      const response = await get(`${RESEND_RECEIVING_EMAIL_PATH}/${encodeURIComponent(emailId)}`);
      return parseUpstream(InboundEmail, await response.json(), SERVICE);
    },

    async getInboundAttachment(emailId, attachmentId) {
      const response = await get(
        `${RESEND_RECEIVING_EMAIL_PATH}/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
      );
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
