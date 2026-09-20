import { AppError, logger } from "@lfsci/kernel";
import type { CountryCode } from "libphonenumber-js/max";
import { type InboundSms, type SmsAdapter, smsmodeV1Adapter } from "./adapter";
import type { SmsConfig } from "./config";
import { SMSMODE_API_KEY_HEADER, SMSMODE_MESSAGES_PATH } from "./config";
import { type FetchLike, mapHttpFailure, mapTransportFailure, readBody } from "./http";
import { normalizeFrenchMobile } from "./phone";

const SERVICE = "smsmode";
const log = logger(SERVICE);

export type SendSmsRequest = {
  to: string;
  text: string;
  defaultCountry?: CountryCode;
  reference?: string;
  expectsReply?: boolean;
};

export type SentSms = { providerMessageId: string; to: string };

export type SmsClient = {
  sendSms(request: SendSmsRequest): Promise<SentSms>;
  parseInbound(payload: unknown): InboundSms;
};

export function createSmsClient(input: {
  config: SmsConfig;
  fetch?: FetchLike;
  adapter?: SmsAdapter;
}): SmsClient {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;
  const adapter = input.adapter ?? smsmodeV1Adapter;

  return {
    async sendSms(request) {
      const recipient = normalizeFrenchMobile(request.to, request.defaultCountry ?? "FR");
      if (!recipient.ok) {
        throw new AppError("VALIDATION", {
          message: "recipient is not a mobile number reachable by SMS",
          details: { reason: recipient.reason },
        });
      }
      if (request.expectsReply && !config.senderIsLongCode) {
        throw new AppError("RULE_VIOLATION", {
          message:
            "an alphanumeric sender cannot receive replies since 2026-03-01; use a long code",
          details: { sender: config.sender },
        });
      }
      if (request.text.trim().length === 0) {
        throw new AppError("VALIDATION", { message: "empty message" });
      }

      const body = adapter.buildSendBody(config, {
        to: recipient.e164,
        text: request.text,
        reference: request.reference,
      });

      let response: Response;
      try {
        response = await doFetch(`${config.baseUrl}${SMSMODE_MESSAGES_PATH}`, {
          method: "POST",
          headers: {
            [SMSMODE_API_KEY_HEADER]: config.apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (cause) {
        throw mapTransportFailure({ service: SERVICE, idempotent: false, cause });
      }

      if (!response.ok) {
        throw mapHttpFailure({
          service: SERVICE,
          status: response.status,
          body: await readBody(response),
        });
      }

      const result = adapter.parseSendResponse(await response.json());
      log.debug({ providerMessageId: result.providerMessageId }, "sms sent");
      return { providerMessageId: result.providerMessageId, to: recipient.e164 };
    },

    parseInbound(payload) {
      return adapter.parseInbound(payload);
    },
  };
}
