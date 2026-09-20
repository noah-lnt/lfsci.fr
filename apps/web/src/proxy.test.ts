import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./proxy";

describe("content security policy", () => {
  it("upgrades insecure requests outside development only", () => {
    expect(contentSecurityPolicy("abc", false)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("abc", true)).not.toContain("upgrade-insecure-requests");
  });

  it("carries the nonce and keeps eval out of a production build", () => {
    const production = contentSecurityPolicy("abc", false);
    expect(production).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(production).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy("abc", true)).toContain("'unsafe-eval'");
  });

  it("closes the directives an attacker would otherwise reach through default-src", () => {
    const policy = contentSecurityPolicy("abc", false);
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
