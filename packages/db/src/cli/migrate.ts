import { runMigrations } from "../migrator";

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");

const result = await runMigrations(url);
for (const name of result.applied) console.error(`applied ${name}`);
console.error(
  `${result.applied.length} migration(s) applied, ${result.alreadyPresent} already present`,
);
