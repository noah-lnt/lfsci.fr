import { z } from "zod";
import type { SmsConfig } from "./config";
import { parseUpstream } from "./http";

const SERVICE = "smsmode";

export type SendRequest = { to: string; text: string; reference: string | undefined };
export type SendResult = { providerMessageId: string };

export type InboundSms = {
  providerMessageId: string;
  from: string;
  to: string;
  text: string;
  receivedAt: string | undefined;
};

export type SmsAdapter = {
  buildSendBody(config: SmsConfig, request: SendRequest): Record<string, unknown>;
  parseSendResponse(body: unknown): SendResult;
  parseInbound(payload: unknown): InboundSms;
};

// Shape observed in the smsmode REST SMS API docs and Postman collection on 2026-09-20.
// `sender` and the whole MO/SDA webhook payload are ASSUMED: TO CONFIRM on an account.
const SendResponse = z.object({
  id: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
});

const InboundPayload = z.object({
  messageId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  text: z.string(),
  receivedAt: z.string().optional(),
});

export const smsmodeV1Adapter: SmsAdapter = {
  buildSendBody(config, request) {
    return {
      recipient: { to: request.to },
      body: { text: request.text },
      from: config.sender,
      ...(request.reference ? { reference: request.reference } : {}),
    };
  },

  parseSendResponse(body) {
    const parsed = parseUpstream(SendResponse, body, SERVICE);
    return { providerMessageId: parsed.messageId ?? parsed.id ?? "" };
  },

  parseInbound(payload) {
    const parsed = parseUpstream(InboundPayload, payload, SERVICE);
    return {
      providerMessageId: parsed.messageId ?? parsed.id ?? "",
      from: parsed.from,
      to: parsed.to,
      text: parsed.text,
      receivedAt: parsed.receivedAt,
    };
  },
};
