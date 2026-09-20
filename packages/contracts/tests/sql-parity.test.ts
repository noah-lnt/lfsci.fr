import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sqlEnums } from "../src/enums";

const schemaPath = fileURLToPath(new URL("../../../docs/schema/lfsci.sql", import.meta.url));

/** Minimal parser: every `CHECK (<col> IN ('a','b'))` inside a CREATE TABLE block. */
const parseSqlEnums = (sql: string): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  let table: string | null = null;
  let block: string[] = [];
  for (const rawLine of sql.split("\n")) {
    if (table === null) {
      const opened = /^CREATE TABLE (\w+) \($/.exec(rawLine);
      if (opened?.[1] !== undefined) {
        table = opened[1];
        block = [];
      }
      continue;
    }
    if (/^\);/.test(rawLine)) {
      const flat = block.join(" ").replace(/\s+/g, " ");
      const checks = /CHECK \(\s*(\w+) IN \(([^)]*)\)/g;
      let match = checks.exec(flat);
      while (match !== null) {
        const column = match[1];
        const values = [...(match[2] ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
        if (column !== undefined) found.set(`${table}.${column}`, values);
        match = checks.exec(flat);
      }
      table = null;
      continue;
    }
    block.push(rawLine.replace(/--.*$/, ""));
  }
  return found;
};

const sqlText = readFileSync(schemaPath, "utf8");
const parsed = parseSqlEnums(sqlText);

describe("Zod enums match docs/schema/lfsci.sql", () => {
  it("the parser finds the schema's CHECK constraints", () => {
    expect(parsed.size).toBeGreaterThan(100);
  });

  it.each([...parsed.keys()].map((key) => [key] as const))(
    "%s is modelled by a Zod enum",
    (key) => {
      expect(
        Object.hasOwn(sqlEnums, key),
        `${key}: CHECK (... IN (...)) exists in docs/schema/lfsci.sql but no Zod enum is mapped to it`,
      ).toBe(true);
    },
  );

  it.each(Object.keys(sqlEnums).map((key) => [key] as const))(
    "%s has exactly the SQL value set",
    (key) => {
      const expected = parsed.get(key);
      expect(
        expected,
        `${key}: no CHECK (... IN (...)) found in docs/schema/lfsci.sql`,
      ).toBeDefined();
      const actual = (sqlEnums as Record<string, { options: string[] }>)[key]?.options ?? [];
      expect([...actual].sort(), `${key}: Zod enum differs from the SQL CHECK`).toEqual(
        [...(expected ?? [])].sort(),
      );
    },
  );
});
