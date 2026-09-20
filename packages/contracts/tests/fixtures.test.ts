import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { contractFixtures } from "../src/fixtures";
import { Money } from "../src/primitives";

describe("fixtures", () => {
  it.each(contractFixtures.map((c) => [c.name, c] as const))("%s parses", (_name, testCase) => {
    const result = testCase.schema.safeParse(testCase.value);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });
});

/** Every value sitting under a `Money` field must be a plain 2-decimal string. */
const twoDecimals = /^-?\d+\.\d{2}$/;

type Unwrapped = { schema: z.ZodType; isMoney: boolean };

const unwrap = (schema: z.ZodType): Unwrapped => {
  let current: z.ZodType = schema;
  let isMoney = current === Money;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = current.def as { type: string; innerType?: z.ZodType };
    if (
      (def.type === "optional" ||
        def.type === "nullable" ||
        def.type === "default" ||
        def.type === "prefault" ||
        def.type === "readonly") &&
      def.innerType !== undefined
    ) {
      current = def.innerType;
      isMoney = isMoney || current === Money;
      continue;
    }
    break;
  }
  return { schema: current, isMoney };
};

const collectMoney = (schema: z.ZodType, value: unknown, path: string, found: string[]): void => {
  const { schema: inner, isMoney } = unwrap(schema);
  if (value === null || value === undefined) return;
  if (isMoney) {
    found.push(path);
    expect(typeof value, `${path} must be a string`).toBe("string");
    expect(value as string, `${path} must carry exactly 2 decimals`).toMatch(twoDecimals);
    return;
  }
  const def = inner.def as {
    type: string;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    options?: z.ZodType[];
  };
  if (def.type === "object" && def.shape !== undefined && typeof value === "object") {
    for (const [key, child] of Object.entries(def.shape)) {
      collectMoney(child, (value as Record<string, unknown>)[key], `${path}.${key}`, found);
    }
    return;
  }
  if (def.type === "array" && def.element !== undefined && Array.isArray(value)) {
    value.forEach((item, index) => {
      collectMoney(def.element as z.ZodType, item, `${path}[${index}]`, found);
    });
    return;
  }
  if (def.type === "union" && def.options !== undefined) {
    for (const option of def.options) {
      if (option.safeParse(value).success) {
        collectMoney(option, value, path, found);
        return;
      }
    }
  }
};

describe("money fixtures", () => {
  it.each(contractFixtures.map((c) => [c.name, c] as const))(
    "%s money fields carry 2 decimals",
    (name, testCase) => {
      const found: string[] = [];
      collectMoney(testCase.schema, testCase.value, name, found);
      expect(Array.isArray(found)).toBe(true);
    },
  );

  it("inspects at least one Money field overall", () => {
    const found: string[] = [];
    for (const testCase of contractFixtures) {
      collectMoney(testCase.schema, testCase.value, testCase.name, found);
    }
    expect(found.length).toBeGreaterThan(50);
  });
});
