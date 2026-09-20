import { type AppError, currentRequestId, logger } from "@lfsci/kernel";
import { type Clock, systemClock } from "./clock";
import {
  type CallContext,
  isRecord,
  mapHttpFailure,
  mapNetworkFailure,
  mapTimeoutFailure,
  mapUnreadableBody,
} from "./errors";
import { type ExchangeRecorder, noopRecorder, safeRecord } from "./exchange";
import { createRateLimiter } from "./rate-limit";
import { defaultRetryPolicy, type RetryPolicy, withRetry } from "./retry";

const log = logger("odoo.client");

export const REQUEST_ID_HEADER = "X-Request-Id";
export const DATABASE_HEADER = "X-Odoo-Database";
export const REQUEST_ID_CONTEXT_KEY = "lfsci_request_id";

export type OdooKwargs = Record<string, unknown>;

export type OdooClientConfig = {
  baseUrl: string;
  apiKey: string;
  database?: string | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  ratePerSecond?: number | undefined;
  timeoutMs?: number | undefined;
  clock?: Clock | undefined;
  recorder?: ExchangeRecorder | undefined;
  retry?: RetryPolicy | undefined;
  random?: (() => number) | undefined;
};

export type OdooCallOptions = {
  idempotent?: boolean | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
};

export type OdooDoc = {
  status: number;
  text: string;
  json: unknown;
};

export type OdooClient = {
  call<T = unknown>(
    model: string,
    method: string,
    kwargs?: OdooKwargs,
    options?: OdooCallOptions,
  ): Promise<T>;
  getDoc(options?: { signal?: AbortSignal }): Promise<OdooDoc>;
  readonly baseUrl: string;
  readonly database: string | undefined;
};

const transportErrors = new WeakSet<object>();

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.length === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function createOdooClient(config: OdooClientConfig): OdooClient {
  const baseUrl = trimSlash(config.baseUrl);
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const clock = config.clock ?? systemClock;
  const recorder = config.recorder ?? noopRecorder;
  const retryPolicy = config.retry ?? defaultRetryPolicy;
  const random = config.random ?? Math.random;
  const defaultTimeoutMs = config.timeoutMs ?? 30_000;
  const limiter = createRateLimiter(config.ratePerSecond ?? 1, clock);

  function headers(requestId: string): Record<string, string> {
    const value: Record<string, string> = {
      Authorization: `bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      [REQUEST_ID_HEADER]: requestId,
    };
    if (config.database !== undefined) value[DATABASE_HEADER] = config.database;
    return value;
  }

  function fail(mapped: { error: AppError; transport: boolean }): never {
    if (mapped.transport) transportErrors.add(mapped.error);
    throw mapped.error;
  }

  async function attempt(
    model: string,
    method: string,
    kwargs: OdooKwargs,
    context: CallContext,
    requestId: string,
    options: OdooCallOptions,
  ): Promise<unknown> {
    const url = `${baseUrl}/json/2/${model}/${method}`;
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;
    const requestHeaders = headers(requestId);
    const startedAt = clock.now();

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(kwargs),
        signal,
      });
    } catch (cause) {
      const durationMs = clock.now() - startedAt;
      const timedOut = timeoutSignal.aborted;
      await safeRecord(recorder, {
        requestId,
        model,
        method,
        request: { url, headers: requestHeaders, body: kwargs },
        response: { error: timedOut ? "timeout" : "network", cause: String(cause) },
        status: null,
        durationMs,
      });
      fail(timedOut ? mapTimeoutFailure(cause, context) : mapNetworkFailure(cause, context));
    }

    const text = await response.text();
    const durationMs = clock.now() - startedAt;
    const parsed = parseJson(text);
    await safeRecord(recorder, {
      requestId,
      model,
      method,
      request: { url, headers: requestHeaders, body: kwargs },
      response: parsed.ok ? parsed.value : { bodyPreview: text.slice(0, 500) },
      status: response.status,
      durationMs,
    });

    if (!parsed.ok) fail(mapUnreadableBody(response.status, text, context));
    if (!response.ok) fail(mapHttpFailure(response.status, parsed.value, context));
    return parsed.value;
  }

  return {
    baseUrl,
    database: config.database,

    async call<T = unknown>(
      model: string,
      method: string,
      kwargs: OdooKwargs = {},
      options: OdooCallOptions = {},
    ): Promise<T> {
      const idempotent = options.idempotent ?? false;
      const requestId = currentRequestId();
      const context: CallContext = { model, method, idempotent };
      const callContext = isRecord(kwargs.context) ? kwargs.context : {};
      const body: OdooKwargs = {
        ...kwargs,
        context: { ...callContext, [REQUEST_ID_CONTEXT_KEY]: requestId },
      };

      const result = await withRetry(
        () => limiter.run(() => attempt(model, method, body, context, requestId, options)),
        {
          policy: retryPolicy,
          clock,
          random,
          retryable: (error) =>
            idempotent && typeof error === "object" && error !== null && transportErrors.has(error),
          onRetry: (attemptNumber, delayMs, error) => {
            log.warn({ model, method, attemptNumber, delayMs, err: error }, "odoo call retried");
          },
        },
      );
      return result as T;
    },

    async getDoc(options: { signal?: AbortSignal } = {}): Promise<OdooDoc> {
      const requestId = currentRequestId();
      const url = `${baseUrl}/doc`;
      const context: CallContext = { model: "/doc", method: "GET", idempotent: true };
      const timeoutSignal = AbortSignal.timeout(defaultTimeoutMs);
      const signal = options.signal
        ? AbortSignal.any([timeoutSignal, options.signal])
        : timeoutSignal;
      const requestHeaders = headers(requestId);

      let response: Response;
      try {
        response = await limiter.run(() =>
          fetchImpl(url, { method: "GET", headers: requestHeaders, signal }),
        );
      } catch (cause) {
        fail(
          timeoutSignal.aborted
            ? mapTimeoutFailure(cause, context)
            : mapNetworkFailure(cause, context),
        );
      }

      const text = await response.text();
      if (!response.ok) {
        const parsed = parseJson(text);
        fail(mapHttpFailure(response.status, parsed.ok ? parsed.value : null, context));
      }
      const parsed = parseJson(text);
      return { status: response.status, text, json: parsed.ok ? parsed.value : null };
    },
  };
}

export function isTransportError(error: unknown): boolean {
  return typeof error === "object" && error !== null && transportErrors.has(error);
}
