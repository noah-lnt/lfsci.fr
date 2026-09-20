import type { OpenDataConfig } from "./config";
import { type FetchLike, mapHttpFailure, mapTransportFailure, readBody } from "./http";

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export async function getWithRetry(input: {
  url: string;
  headers: Record<string, string>;
  service: string;
  config: OpenDataConfig;
  fetch: FetchLike;
  sleep?: Sleep;
}): Promise<Response> {
  const sleep = input.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    let response: Response;
    try {
      response = await input.fetch(input.url, {
        method: "GET",
        headers: input.headers,
        signal: AbortSignal.timeout(input.config.timeoutMs),
      });
    } catch (cause) {
      throw mapTransportFailure({ service: input.service, idempotent: true, cause });
    }
    if (response.ok) return response;
    if (response.status === 429 && attempt < input.config.maxRetries) {
      attempt += 1;
      await sleep(retryAfterMs(response) ?? 1000 * attempt);
      continue;
    }
    throw mapHttpFailure({
      service: input.service,
      status: response.status,
      body: await readBody(response),
    });
  }
}
