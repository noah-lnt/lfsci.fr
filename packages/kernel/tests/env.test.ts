import { describe, expect, it } from "vitest";
import { z } from "zod";
import { optionalString, parseEnv, requiredString } from "../src/env";

describe("parseEnv", () => {
  it("reads a blank value as an unset key, the way .env.example leaves it", () => {
    const parsed = parseEnv(
      { A: requiredString, B: optionalString, C: z.string().default("fallback") },
      { A: "value", B: "", C: "   " },
    );
    expect(parsed).toEqual({ A: "value", C: "fallback" });
    expect(parsed.B).toBeUndefined();
  });

  it("still refuses a required key that is blank", () => {
    expect(() => parseEnv({ A: requiredString }, { A: "" })).toThrow(/invalid environment: A/);
  });
});
