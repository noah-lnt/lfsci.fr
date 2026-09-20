import { createDb, type DbHandle, runMigrations } from "@lfsci/db";
import { sql } from "drizzle-orm";
import postgres from "postgres";

export const ORG_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const ENTITY_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** Own database: the db and worker suites truncate theirs while the unit project runs. */
export const TEST_DATABASE_URL = (() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_migrate`;
  return parsed.toString();
})();

let app: DbHandle | undefined;
let admin: DbHandle | undefined;

function requireUrl(): string {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is unset");
  return TEST_DATABASE_URL;
}

export function appDb(): DbHandle {
  if (!app) app = createDb({ url: requireUrl(), max: 4 });
  return app;
}

export function adminDb(): DbHandle {
  if (!admin) admin = createDb({ url: requireUrl(), max: 2, appRole: null });
  return admin;
}

export async function closeDbs(): Promise<void> {
  const handles = [app, admin].filter((handle): handle is DbHandle => handle !== undefined);
  app = undefined;
  admin = undefined;
  await Promise.all(handles.map((handle) => handle.close()));
}

export async function prepareDatabase(): Promise<void> {
  const target = requireUrl();
  const name = new URL(target).pathname.slice(1);
  const maintenance = new URL(target);
  maintenance.pathname = "/postgres";
  const client = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  try {
    const found = await client`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (found.length === 0) await client.unsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
  await runMigrations(target);
}

export async function truncateAll(): Promise<void> {
  const db = adminDb().db;
  const rows = await db.execute<{ list: string | null }>(sql`
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS list
      FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'schema_migration'
  `);
  const list = [...rows][0]?.list;
  if (list) await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

export async function seedOrganization(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO organization (id, code, name) VALUES (${ORG_ID}::uuid, 'test', 'Organisation test')`);
  await db.execute(sql`
    INSERT INTO legal_entity (id, organization_id, name, odoo_company_id)
    VALUES (${ENTITY_ID}::uuid, ${ORG_ID}::uuid, 'SCI Exemple', 1)`);
  await db.execute(sql`
    INSERT INTO building (organization_id, legal_entity_id, code, name, address_line1)
    VALUES (${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'IMM-01', 'Immeuble 1', '1 rue Exemple')`);
}

export async function exec(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  return [...(await adminDb().db.execute(query))];
}
