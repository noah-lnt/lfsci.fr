import { createDb, type DbHandle } from "@lfsci/db";
import { sql } from "drizzle-orm";
import { runMigrationsFrom } from "../src/migrate";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export const SKIP_REASON =
  "TEST_DATABASE_URL is unset — the outbox pipeline is only meaningful against a real PostgreSQL (TRUNCATE, RLS, FOR UPDATE SKIP LOCKED).";

export const ORG_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const ENTITY_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const USER_ID = "cccccccc-3333-4333-8333-cccccccccccc";
export const SUPPLIER_REFERENCE = "FOURNISSEUR-TEST";

let app: DbHandle | undefined;
let admin: DbHandle | undefined;

export function requireUrl(): string {
  if (!TEST_DATABASE_URL) throw new Error(SKIP_REASON);
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

export async function migrate(): Promise<void> {
  await runMigrationsFrom(requireUrl(), "packages/db/migrations");
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
    INSERT INTO organization (id, code, name) VALUES (${ORG_ID}::uuid, 'test', 'Organisation test')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO app_user (id, email, full_name)
    VALUES (${USER_ID}::uuid, 'test@exemple.test', 'Utilisateur test')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO legal_entity (id, organization_id, name)
    VALUES (${ENTITY_ID}::uuid, ${ORG_ID}::uuid, 'SCI Test')
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO expense (id, organization_id, legal_entity_id, document_kind, supplier_reference,
                         issued_on, total_excl_tax, tax_amount, total_incl_tax)
    VALUES (${EXPENSE_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'invoice',
            ${SUPPLIER_REFERENCE}, '2026-09-01', 100.00, 20.00, 120.00)
    ON CONFLICT DO NOTHING
  `);
}

export const EXPENSE_ID = "dddddddd-4444-4444-8444-dddddddddddd";
