import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, servedOverTls } from "./proxy";

const prodTls = { isDev: false, servedOverTls: true };
const prodPlain = { isDev: false, servedOverTls: false };
const dev = { isDev: true, servedOverTls: false };

describe("content security policy", () => {
  it("upgrades insecure requests only for a site that answers on https", () => {
    expect(contentSecurityPolicy("abc", prodTls)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("abc", prodPlain)).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("abc", dev)).not.toContain("upgrade-insecure-requests");
  });

  it("reads the scheme from the app's own URL, never from the environment name", () => {
    expect(servedOverTls({ APP_URL: "https://app.example.test" })).toBe(true);
    expect(servedOverTls({ BETTER_AUTH_URL: "https://app.example.test" })).toBe(true);
    expect(servedOverTls({ APP_URL: "http://localhost:3000", NODE_ENV: "production" })).toBe(false);
    expect(servedOverTls({})).toBe(false);
  });

  it("carries the nonce and keeps eval out of a production build", () => {
    const production = contentSecurityPolicy("abc", prodTls);
    expect(production).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(production).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy("abc", dev)).toContain("'unsafe-eval'");
  });

  it("closes the directives an attacker would otherwise reach through default-src", () => {
    const policy = contentSecurityPolicy("abc", prodTls);
    for (const directive of [
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
  });
});
