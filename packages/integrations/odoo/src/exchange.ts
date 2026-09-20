import { logger, redactValue } from "@lfsci/kernel";

const log = logger("odoo.exchange");

export type ExchangeRecord = {
  requestId: string;
  model: string;
  method: string;
  request: unknown;
  response: unknown;
  status: number | null;
  durationMs: number;
};

export type ExchangeRecorder = {
  record(exchange: ExchangeRecord): void | Promise<void>;
};

export const noopRecorder: ExchangeRecorder = {
  record: () => undefined,
};

export function createMemoryRecorder(): ExchangeRecorder & { readonly records: ExchangeRecord[] } {
  const records: ExchangeRecord[] = [];
  return {
    records,
    record(exchange) {
      records.push(exchange);
    },
  };
}

export function redactExchange(exchange: ExchangeRecord): ExchangeRecord {
  return {
    ...exchange,
    request: redactValue(exchange.request),
    response: redactValue(exchange.response),
  };
}

export async function safeRecord(
  recorder: ExchangeRecorder,
  exchange: ExchangeRecord,
): Promise<void> {
  try {
    await recorder.record(redactExchange(exchange));
  } catch (cause) {
    log.warn(
      { err: cause, model: exchange.model, method: exchange.method },
      "exchange record failed",
    );
  }
}
