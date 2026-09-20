import { beforeEach, describe, expect, it } from "vitest";
import { clientIp, consume, limitPerMinute, resetRateLimits, tooManyRequests } from "./rate-limit";

const env = { RATE_LIMIT_AUTH_PER_MINUTE: "3" };
const START = 1_700_000_000_000;

describe("rate limit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("reads the limit from the environment and falls back on a bad value", () => {
    expect(limitPerMinute("auth", env)).toBe(3);
    expect(limitPerMinute("auth", { RATE_LIMIT_AUTH_PER_MINUTE: "zero" })).toBe(30);
    expect(limitPerMinute("auth", { RATE_LIMIT_AUTH_PER_MINUTE: "0" })).toBe(30);
    expect(limitPerMinute("assistant", {})).toBe(20);
    expect(limitPerMinute("webhook", {})).toBe(120);
  });

  it("allows the whole budget then refuses the next call", () => {
    for (let call = 1; call <= 3; call += 1) {
      expect(consume("auth", "10.0.0.1", START, env).allowed).toBe(true);
    }
    const refused = consume("auth", "10.0.0.1", START, env);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBe(20);
  });

  it("counts each address and each route separately", () => {
    for (let call = 1; call <= 3; call += 1) consume("auth", "10.0.0.1", START, env);
    expect(consume("auth", "10.0.0.2", START, env).allowed).toBe(true);
    expect(consume("assistant", "10.0.0.1", START, env).allowed).toBe(true);
  });

  it("refills over the window", () => {
    for (let call = 1; call <= 3; call += 1) consume("auth", "10.0.0.1", START, env);
    expect(consume("auth", "10.0.0.1", START + 19_000, env).allowed).toBe(false);
    expect(consume("auth", "10.0.0.1", START + 20_000, env).allowed).toBe(true);
    expect(consume("auth", "10.0.0.1", START + 60_000, env).allowed).toBe(true);
  });

  it("takes the first hop of x-forwarded-for, not the proxy chain", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.1.0.1" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("answers 429 with retry-after and the correlation id", async () => {
    const decision = { allowed: false, limit: 3, remaining: 0, retryAfterSeconds: 20 };
    const response = tooManyRequests(decision, "0199a000-0000-7000-8000-000000000001");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(response.headers.get("x-request-id")).toBe("0199a000-0000-7000-8000-000000000001");
    await expect(response.json()).resolves.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});
