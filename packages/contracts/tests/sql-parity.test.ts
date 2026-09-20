import { readdirSync, readFileSync } from "node:fs";
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

/** Migrations after 0001 add their CHECK constraints with ALTER TABLE. */
const parseAlterEnums = (sql: string, file: string): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  const stripped = sql.replace(/--.*$/gm, "").replace(/\s+/g, " ");
  const statements = /ALTER TABLE (\w+)([^;]*);/g;
  let statement = statements.exec(stripped);
  while (statement !== null) {
    const table = statement[1];
    const checks = /CHECK \(\s*(\w+) IN \(([^)]*)\)/g;
    let match = checks.exec(statement[2] ?? "");
    while (match !== null) {
      const column = match[1];
      const values = [...(match[2] ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
      if (table !== undefined && column !== undefined) found.set(`${table}.${column}`, values);
      match = checks.exec(statement[2] ?? "");
    }
    statement = statements.exec(stripped);
  }
  // A row-level security policy's WITH CHECK is not a value list; only a column
  // CHECK (... IN (...)) carries an enum this test can compare.
  const columnChecks = stripped.replace(/WITH CHECK/g, "");
  if (found.size === 0 && /CHECK \(/.test(columnChecks) && !/CREATE TABLE/.test(columnChecks)) {
    throw new Error(`${file}: a CHECK was written in a form this parser does not read`);
  }
  return found;
};

const migrationsDir = fileURLToPath(new URL("../../db/migrations", import.meta.url));

const sqlText = readFileSync(schemaPath, "utf8");
const parsed = parseSqlEnums(sqlText);
for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
  if (file.startsWith("0001")) continue;
  const text = readFileSync(`${migrationsDir}/${file}`, "utf8");
  for (const [key, values] of parseSqlEnums(text)) parsed.set(key, values);
  for (const [key, values] of parseAlterEnums(text, file)) parsed.set(key, values);
}

describe("Zod enums match the SQL CHECK constraints", () => {
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
