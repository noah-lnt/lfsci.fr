import { messageByCode } from "@lfsci/contracts";
import { REQUEST_ID_HEADER } from "@lfsci/kernel";

/**
 * In-process token bucket for the routes that answer before any session exists.
 * One Node process per container today; a second replica doubles the effective
 * ceiling, which is why the limits are an env key and not a constant.
 */
export type RateLimitRoute = "webhook" | "assistant" | "auth";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type EnvSource = Record<string, string | undefined>;

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;

const ENV_KEY: Record<RateLimitRoute, string> = {
  webhook: "RATE_LIMIT_WEBHOOK_PER_MINUTE",
  assistant: "RATE_LIMIT_ASSISTANT_PER_MINUTE",
  auth: "RATE_LIMIT_AUTH_PER_MINUTE",
};

// A sign-up or sign-in is several POSTs; ten a minute locked a real user out
// after one mistyped password and a retry.
const FALLBACK: Record<RateLimitRoute, number> = {
  webhook: 120,
  assistant: 20,
  auth: 30,
};

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export function limitPerMinute(route: RateLimitRoute, source: EnvSource = process.env): number {
  const raw = source[ENV_KEY[route]];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : FALLBACK[route];
}

/** Behind Traefik the client address is the FIRST hop of x-forwarded-for; the
 * later hops are proxies and the socket address is the proxy itself. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > WINDOW_MS * 5) buckets.delete(key);
  }
}

export function consume(
  route: RateLimitRoute,
  ip: string,
  now: number = Date.now(),
  source: EnvSource = process.env,
): RateLimitDecision {
  const limit = limitPerMinute(route, source);
  const key = `${route}:${ip}`;
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / WINDOW_MS) * limit;
  const tokens = Math.min(limit, bucket.tokens + Math.max(0, refill));

  if (buckets.size >= MAX_BUCKETS) prune(now);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(((1 - tokens) * WINDOW_MS) / limit / 1000)),
    };
  }

  const left = tokens - 1;
  buckets.set(key, { tokens: left, updatedAt: now });
  return { allowed: true, limit, remaining: Math.floor(left), retryAfterSeconds: 0 };
}

export function rateLimit(route: RateLimitRoute, request: Request): RateLimitDecision {
  return consume(route, clientIp(request.headers));
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function tooManyRequests(decision: RateLimitDecision, requestId: string): Response {
  return Response.json(
    { code: "QUOTA_EXCEEDED", message: messageByCode.QUOTA_EXCEEDED, requestId },
    {
      status: 429,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "retry-after": String(decision.retryAfterSeconds),
        "ratelimit-limit": String(decision.limit),
        "ratelimit-remaining": "0",
      },
    },
  );
}
