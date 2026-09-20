import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsDir = join(here, "..", "migrations");

export type MigrationResult = { applied: string[]; alreadyPresent: number };

export type MigrationOptions = { dir?: string };

export async function runMigrations(
  url: string,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const dir = options.dir ?? migrationsDir;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Map<string, string>(
      (
        await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM schema_migration`
      ).map((r) => [r.name, r.checksum]),
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
