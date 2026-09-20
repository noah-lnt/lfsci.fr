import { describe, expect, it } from "vitest";
import { secretMatches, sentSecret } from "./secret";

describe("secretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cr3t", "s3cr3t")).toBe(true);
    expect(secretMatches("s3cr3T", "s3cr3t")).toBe(false);
    expect(secretMatches("s3cr3t-longer", "s3cr3t")).toBe(false);
  });

  it("refuses a missing value rather than falling open", () => {
    expect(secretMatches(null, "s3cr3t")).toBe(false);
    expect(secretMatches("", "s3cr3t")).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(secretMatches("anything", "")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});

describe("sentSecret", () => {
  it("reads the header first, then the query string", () => {
    const withHeader = new Request("https://lfsci.test/api/webhooks/smsmode?secret=query", {
      headers: { "x-smsmode-secret": "header" },
    });
    expect(sentSecret(withHeader, "x-smsmode-secret")).toBe("header");

    const withQuery = new Request("https://lfsci.test/api/webhooks/smsmode?secret=query");
    expect(sentSecret(withQuery, "x-smsmode-secret")).toBe("query");

    const withNeither = new Request("https://lfsci.test/api/webhooks/smsmode");
    expect(sentSecret(withNeither, "x-smsmode-secret")).toBeNull();
  });
});
