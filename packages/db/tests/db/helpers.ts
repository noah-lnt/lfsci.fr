import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "../../src/client";
import { runMigrations } from "../../src/migrator";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function requireTestDatabaseUrl(): string {
  const url = TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required for the db test project. It is never derived from DATABASE_URL: this suite truncates every table.",
    );
  }
  return url;
}

let handle: DbHandle | undefined;
let admin: DbHandle | undefined;
const extra: DbHandle[] = [];

/** Application handle: withTenant switches it to lfsci_app so RLS applies. */
export function testDb(): DbHandle {
  if (!handle) handle = createDb({ url: requireTestDatabaseUrl(), max: 4 });
  return handle;
}

/** Owner handle with no role switch: setup, tamper checks, cross-tenant reads. */
export function adminDb(): DbHandle {
  if (!admin) admin = createDb({ url: requireTestDatabaseUrl(), max: 2, appRole: null });
  return admin;
}

/** Separate pool, for proving two claimants never get the same outbox row. */
export function extraDb(): DbHandle {
  const created = createDb({ url: requireTestDatabaseUrl(), max: 1 });
  extra.push(created);
  return created;
}

export async function closeTestDbs(): Promise<void> {
  const all = [handle, admin, ...extra].filter((h): h is DbHandle => h !== undefined);
  handle = undefined;
  admin = undefined;
  extra.length = 0;
  await Promise.all(all.map((h) => h.close()));
}

export async function migrateTestDatabase(): Promise<void> {
  await runMigrations(requireTestDatabaseUrl());
}

/** Every public table except the migrator's own bookkeeping. */
export async function truncateAll(): Promise<void> {
  const db = adminDb().db;
  const rows = await db.execute<{ list: string | null }>(sql`
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS list
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> 'schema_migration'
  `);
  const list = [...rows][0]?.list;
  if (!list) return;
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";
export const USER_A = "33333333-3333-4333-8333-333333333333";

export type SeededOrgs = { orgA: string; orgB: string; userA: string };

export async function seedTwoOrganizations(): Promise<SeededOrgs> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO organization (id, code, name) VALUES
      (${ORG_A}::uuid, 'org-a', 'Organisation A'),
      (${ORG_B}::uuid, 'org-b', 'Organisation B')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO app_user (id, email, full_name)
    VALUES (${USER_A}::uuid, 'alex.durand@exemple.test', 'Alex Durand')
    ON CONFLICT DO NOTHING
  `);
  return { orgA: ORG_A, orgB: ORG_B, userA: USER_A };
}

export async function insertLegalEntity(organizationId: string, name: string): Promise<string> {
  const rows = await adminDb().db.execute<{ id: string }>(sql`
    INSERT INTO legal_entity (organization_id, name) VALUES (${organizationId}::uuid, ${name})
    RETURNING id
  `);
  const row = [...rows][0];
  if (!row) throw new Error("legal_entity insert returned no row");
  return row.id;
}

/** Drizzle wraps driver failures in "Failed query: …"; the real message is the cause. */
export function pgMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

export async function pgErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return pgMessage(error);
  }
  throw new Error("expected the query to fail");
}
