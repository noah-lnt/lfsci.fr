import { Client } from "pg";
import { beforeAll } from "vitest";

const url = process.env.TEST_DATABASE_URL;

async function ensureDatabase(target: string): Promise<void> {
  const parsed = new URL(target);
  const name = parsed.pathname.slice(1);
  const maintenance = new URL(target);
  maintenance.pathname = "/postgres";
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  if (url) await ensureDatabase(url);
}, 60_000);
