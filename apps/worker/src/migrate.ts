import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { logger } from "@lfsci/kernel";
import postgres from "postgres";

const log = logger("worker.migrate");

export type MigrationResult = { applied: string[]; alreadyPresent: number };

/**
 * `runMigrations` from `@lfsci/db` resolves the folder from its own module
 * location, which does not exist in the worker image (the run stage copies the
 * migrations to ./migrations and keeps only package.json in the packages). This
 * is the same algorithm with the directory injected; the day `runMigrations`
 * takes a `dir` option, this file becomes a one-line call.
 */
export async function runMigrationsFrom(url: string, dir: string): Promise<MigrationResult> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
    const applied = new Map<string, string>(
      (
        await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM schema_migration`
      ).map((row) => [row.name, row.checksum]),
    );

    const done: string[] = [];
    for (const name of files) {
      const body = await readFile(join(dir, name), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
      const previous = applied.get(name);
      if (previous === checksum) continue;
      if (previous !== undefined) {
        throw new Error(`migration ${name} changed after being applied (checksum mismatch)`);
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migration (name, checksum) VALUES (${name}, ${checksum})`;
      });
      done.push(name);
    }
    return { applied: done, alreadyPresent: files.length - done.length };
  } finally {
    await sql.end();
  }
}

export function migrationsDirFromEnv(source: NodeJS.ProcessEnv = process.env): string {
  const configured = source.MIGRATIONS_DIR;
  if (configured && configured.trim().length > 0) {
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }
  return resolve(process.cwd(), "migrations");
}

export async function main(): Promise<void> {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    log.error("DATABASE_ADMIN_URL (or DATABASE_URL) is required");
    process.exitCode = 1;
    return;
  }
  const dir = migrationsDirFromEnv();
  try {
    const result = await runMigrationsFrom(url, dir);
    log.info(
      { dir, applied: result.applied, alreadyPresent: result.alreadyPresent },
      result.applied.length === 0 ? "all migrations already present" : "migrations applied",
    );
  } catch (error) {
    log.error({ dir, err: error }, "migration failed");
    process.exitCode = 1;
  }
}

// `process.exitCode`, never `process.exit()`: pino's transport must flush first.
if (process.argv[1]?.endsWith("migrate.js") || process.argv[1]?.endsWith("migrate.ts")) {
  await main();
}
