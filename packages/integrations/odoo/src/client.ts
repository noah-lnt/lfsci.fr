import { AppError, currentRequestId, logger } from "@lfsci/kernel";
import { type Clock, systemClock } from "./clock";
import {
  type CallContext,
  isAuthFault,
  isRecord,
  mapHttpFailure,
  mapNetworkFailure,
  mapRpcFault,
  mapTimeoutFailure,
  mapUnreadableBody,
  parseFault,
} from "./errors";
import { type ExchangeRecorder, noopRecorder, safeRecord } from "./exchange";
import { createRateLimiter } from "./rate-limit";
import { defaultRetryPolicy, type RetryPolicy, withRetry } from "./retry";

const log = logger("odoo.client");

export const REQUEST_ID_HEADER = "X-Request-Id";
export const DATABASE_HEADER = "X-Odoo-Database";
export const REQUEST_ID_CONTEXT_KEY = "lfsci_request_id";

/** `json2` is Odoo 19's `/json/2/<model>/<method>`; `jsonrpc` is the 18 and earlier `/jsonrpc`. */
export type OdooTransport = "json2" | "jsonrpc";

export type OdooKwargs = Record<string, unknown>;

export type OdooClientConfig = {
  baseUrl: string;
  apiKey: string;
  database?: string | undefined;
  transport?: OdooTransport | undefined;
  login?: string | undefined;
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
  readonly transport: OdooTransport;
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

function omit(source: OdooKwargs, keys: string[]): OdooKwargs {
  const out: OdooKwargs = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) out[key] = value;
  }
  return out;
}

/**
 * `execute_kw` refuses as a keyword what the ORM signature takes positionally:
 * measured on Odoo 18, `create` needs vals_list as args[0] and `write` needs
 * [ids, vals]; everything else takes ids first and the rest as keywords.
 */
export function shapeExecuteKw(
  method: string,
  kwargs: OdooKwargs,
): { args: unknown[]; kwargs: OdooKwargs } {
  switch (method) {
    case "create":
      return { args: [kwargs.vals_list ?? []], kwargs: omit(kwargs, ["vals_list"]) };
    case "write":
      return { args: [kwargs.ids ?? [], kwargs.vals ?? {}], kwargs: omit(kwargs, ["ids", "vals"]) };
    case "unlink":
      return { args: [kwargs.ids ?? []], kwargs: omit(kwargs, ["ids"]) };
    default:
      return kwargs.ids === undefined
        ? { args: [], kwargs }
        : { args: [kwargs.ids], kwargs: omit(kwargs, ["ids"]) };
  }
}

function redactRpcEnvelope(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.params) || !Array.isArray(body.params.args)) return body;
  const args = [...body.params.args];
  if (body.params.service === "common") args[2] = "[redacted]";
  if (body.params.service === "object") args[2] = "[redacted]";
  return { ...body, params: { ...body.params, args } };
}

export function createOdooClient(config: OdooClientConfig): OdooClient {
  const baseUrl = trimSlash(config.baseUrl);
  const transport: OdooTransport = config.transport ?? "json2";
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const clock = config.clock ?? systemClock;
  const recorder = config.recorder ?? noopRecorder;
  const retryPolicy = config.retry ?? defaultRetryPolicy;
  const random = config.random ?? Math.random;
  const defaultTimeoutMs = config.timeoutMs ?? 30_000;
  const limiter = createRateLimiter(config.ratePerSecond ?? 1, clock);

  if (transport === "jsonrpc" && (config.database === undefined || config.login === undefined)) {
    throw new AppError("VALIDATION", {
      message: "le transport jsonrpc exige une base et un login Odoo",
      details: { database: config.database, login: config.login },
    });
  }

  let rpcId = 0;
  let uid: number | undefined;
  let authInFlight: Promise<number> | undefined;

  function headers(requestId: string): Record<string, string> {
    const value: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      [REQUEST_ID_HEADER]: requestId,
    };
    if (transport === "json2") {
      value.Authorization = `bearer ${config.apiKey}`;
      if (config.database !== undefined) value[DATABASE_HEADER] = config.database;
    }
    return value;
  }

  function fail(mapped: { error: AppError; transport: boolean }): never {
    if (mapped.transport) transportErrors.add(mapped.error);
    throw mapped.error;
  }

  async function post(input: {
    url: string;
    body: unknown;
    recordedBody: unknown;
    context: CallContext;
    requestId: string;
    options: OdooCallOptions;
  }): Promise<unknown> {
    const { url, body, recordedBody, context, requestId, options } = input;
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
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      const durationMs = clock.now() - startedAt;
      const timedOut = timeoutSignal.aborted;
      await safeRecord(recorder, {
        requestId,
        model: context.model,
        method: context.method,
        request: { url, headers: requestHeaders, body: recordedBody },
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
      model: context.model,
      method: context.method,
      request: { url, headers: requestHeaders, body: recordedBody },
      response: parsed.ok ? parsed.value : { bodyPreview: text.slice(0, 500) },
      status: response.status,
      durationMs,
    });

    if (!parsed.ok) fail(mapUnreadableBody(response.status, text, context));
    if (!response.ok) fail(mapHttpFailure(response.status, parsed.value, context));
    return parsed.value;
  }

  function rpcEnvelope(service: string, method: string, args: unknown[]): unknown {
    rpcId += 1;
    return { jsonrpc: "2.0", method: "call", id: rpcId, params: { service, method, args } };
  }

  async function sendRpc(
    service: string,
    rpcMethod: string,
    args: unknown[],
    context: CallContext,
    requestId: string,
    options: OdooCallOptions,
  ): Promise<unknown> {
    const body = rpcEnvelope(service, rpcMethod, args);
    const envelope = await post({
      url: `${baseUrl}/jsonrpc`,
      body,
      recordedBody: redactRpcEnvelope(body),
      context,
      requestId,
      options,
    });
    if (isRecord(envelope) && envelope.error !== undefined) {
      fail(mapRpcFault(envelope.error, context));
    }
    return isRecord(envelope) ? envelope.result : undefined;
  }

  async function authenticate(requestId: string, options: OdooCallOptions): Promise<number> {
    const context: CallContext = { model: "common", method: "authenticate", idempotent: true };
    const result = await limiter.run(() =>
      sendRpc(
        "common",
        "authenticate",
        [config.database, config.login, config.apiKey, {}],
        context,
        requestId,
        options,
      ),
    );
    if (typeof result !== "number") {
      fail({
        error: new AppError("UPSTREAM_REJECTED", {
          message: "Odoo a refusé la clé d'API du compte de service",
          details: { model: "common", method: "authenticate", login: config.login },
        }),
        transport: false,
      });
    }
    return result;
  }

  function ensureUid(requestId: string, options: OdooCallOptions): Promise<number> {
    if (uid !== undefined) return Promise.resolve(uid);
    authInFlight ??= authenticate(requestId, options).then(
      (value) => {
        uid = value;
        authInFlight = undefined;
        return value;
      },
      (error: unknown) => {
        authInFlight = undefined;
        throw error;
      },
    );
    return authInFlight;
  }

  async function attemptJson2(
    model: string,
    method: string,
    kwargs: OdooKwargs,
    context: CallContext,
    requestId: string,
    options: OdooCallOptions,
  ): Promise<unknown> {
    const url = `${baseUrl}/json/2/${model}/${method}`;
    return post({ url, body: kwargs, recordedBody: kwargs, context, requestId, options });
  }

  function executeKw(
    currentUid: number,
    model: string,
    method: string,
    kwargs: OdooKwargs,
    context: CallContext,
    requestId: string,
    options: OdooCallOptions,
  ): Promise<unknown> {
    const shaped = shapeExecuteKw(method, kwargs);
    return sendRpc(
      "object",
      "execute_kw",
      [config.database, currentUid, config.apiKey, model, method, shaped.args, shaped.kwargs],
      context,
      requestId,
      options,
    );
  }

  function isAuthError(error: unknown): boolean {
    if (!(error instanceof AppError) || !isRecord(error.details?.odoo)) return false;
    return isAuthFault(parseFault(error.details.odoo));
  }

  /** Authentication sits outside the limiter slot: the limiter is a queue, nesting it deadlocks. */
  async function attemptJsonRpc(
    model: string,
    method: string,
    kwargs: OdooKwargs,
    context: CallContext,
    requestId: string,
    options: OdooCallOptions,
  ): Promise<unknown> {
    const currentUid = await ensureUid(requestId, options);
    try {
      return await limiter.run(() =>
        executeKw(currentUid, model, method, kwargs, context, requestId, options),
      );
    } catch (error) {
      if (!isAuthError(error) || !context.idempotent) throw error;
      uid = undefined;
      log.warn({ model, method }, "odoo session refused, re-authenticating");
      const fresh = await ensureUid(requestId, options);
      return limiter.run(() =>
        executeKw(fresh, model, method, kwargs, context, requestId, options),
      );
    }
  }

  return {
    baseUrl,
    database: config.database,
    transport,

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

      const attempt =
        transport === "json2"
          ? () => limiter.run(() => attemptJson2(model, method, body, context, requestId, options))
          : () => attemptJsonRpc(model, method, body, context, requestId, options);

      const result = await withRetry(attempt, {
        policy: retryPolicy,
        clock,
        random,
        retryable: (error) =>
          idempotent && typeof error === "object" && error !== null && transportErrors.has(error),
        onRetry: (attemptNumber, delayMs, error) => {
          log.warn({ model, method, attemptNumber, delayMs, err: error }, "odoo call retried");
        },
      });
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
