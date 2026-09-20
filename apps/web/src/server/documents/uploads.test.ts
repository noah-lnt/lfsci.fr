import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { extractionKindFor } = await import("./uploads");

describe("a capture reaches the analysis job with a kind the job accepts", () => {
  it("maps the natures that have an extraction schema, and qualifies the rest", () => {
    expect(extractionKindFor("invoice")).toBe("invoice");
    expect(extractionKindFor("insurance")).toBe("attestation");
    expect(extractionKindFor("to_qualify")).toBe("inboxIntent");
    expect(extractionKindFor("photo")).toBe("inboxIntent");
  });
});
