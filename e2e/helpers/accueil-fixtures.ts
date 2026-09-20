import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { sql } from "drizzle-orm";
// Playwright compiles specs as CommonJS and the @lfsci/db index re-exports the
// ESM-only migrator, so the fixtures import the same sources module by module.
import { hashPayload } from "../../packages/db/src/canonical";
import { createDb, type DbHandle } from "../../packages/db/src/client";
import { createCommand } from "../../packages/db/src/commands";
import { ensureObjectRef, linkDeadline } from "../../packages/db/src/object-ref";
import { withoutTenant } from "../../packages/db/src/tenant";

function databaseUrl(): string {
  const envFile = resolve(process.cwd(), ".env");
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  return process.env.DATABASE_URL ?? "postgres://lfsci:lfsci@127.0.0.1:5434/lfsci";
}

let handle: DbHandle | undefined;

/** Fixtures run as the connection owner: they seed rows, they never test RLS. */
export function db(): DbHandle {
  if (!handle) handle = createDb({ url: databaseUrl(), max: 2, appRole: null });
  return handle;
}

export async function closeDb(): Promise<void> {
  await handle?.close();
  handle = undefined;
}

export type Owner = { slug: string; organizationId: string; legalEntityId: string };

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** The first account creates the organization and becomes its owner_admin. */
export async function signUpOwner(page: Page): Promise<Owner> {
  const slug = unique("sci");

  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Test");
  await page.getByLabel("Adresse e-mail").fill(`${slug}@example.test`);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

  const organizationId = await organizationIdOf(slug);
  const legalEntityId = await insertLegalEntity(organizationId, "SCI de démonstration");
  return { slug, organizationId, legalEntityId };
}

async function organizationIdOf(slug: string): Promise<string> {
  const rows = await db().sql<{ id: string }[]>`
    SELECT id FROM organization WHERE code = ${slug.toUpperCase().slice(0, 32)} LIMIT 1`;
  const row = rows[0];
  expect(row, `organization for ${slug}`).toBeTruthy();
  return row?.id as string;
}

export async function insertLegalEntity(organizationId: string, name: string): Promise<string> {
  return withoutTenant(db(), async (tx) => {
    const rows = [
      ...(await tx.execute<{ id: string }>(sql`
        INSERT INTO legal_entity (organization_id, name) VALUES (${organizationId}::uuid, ${name})
        RETURNING id`)),
    ];
    return rows[0]?.id as string;
  });
}

export type DeadlineFixture = {
  title: string;
  /** Civil date, `YYYY-MM-DD`. */
  dueOn: string;
  type?: string;
  priority?: "low" | "normal" | "high" | "critical";
};

export async function insertDeadline(owner: Owner, fixture: DeadlineFixture): Promise<string> {
  return withoutTenant(db(), async (tx) => {
    const rows = [
      ...(await tx.execute<{ id: string }>(sql`
        INSERT INTO deadline (organization_id, type, title, due_on, priority, status)
        VALUES (${owner.organizationId}::uuid, ${fixture.type ?? "lease_revision"},
                ${fixture.title}, ${fixture.dueOn}::date, ${fixture.priority ?? "normal"}, 'planned')
        RETURNING id`)),
    ];
    const id = rows[0]?.id as string;
    const objectRefId = await ensureObjectRef(tx, {
      organizationId: owner.organizationId,
      kind: "legal_entity",
      id: owner.legalEntityId,
    });
    await linkDeadline(tx, { organizationId: owner.organizationId, deadlineId: id, objectRefId });
    return id;
  });
}

export type PreparedCommand = { commandId: string; payloadHash: string; version: number };

/** A level-D command waiting for the owner, exactly as `rent.prepareTerms` leaves one. */
export async function insertPreparedCommand(owner: Owner): Promise<PreparedCommand> {
  const payload = {
    leaseId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    rentRevisionId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
    indexName: "irl" as const,
    referenceQuarter: "2026-T2",
    previousIndexValue: "143.460000",
    newIndexValue: "146.120000",
    baseRent: "800.00",
    proposedRent: "814.83",
    currency: "EUR",
    effectiveOn: "2026-10-01",
  };

  return withoutTenant(db(), async (tx) => {
    const row = await createCommand(tx, {
      organizationId: owner.organizationId,
      commandType: "revise_rent",
      operationKey: `revise_rent:${unique("e2e")}`,
      payload,
      payloadHash: hashPayload(payload),
      autonomyLevel: "D",
      status: "prepared",
      correlationId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d",
    });
    return { commandId: row.id, payloadHash: row.payloadHash, version: row.version };
  });
}

export async function readCommand(
  commandId: string,
): Promise<{ status: string; outboxRows: number }> {
  const rows = await db().sql<{ status: string; outbox: string }[]>`
    SELECT c.status,
           (SELECT count(*)::text FROM outbox_entry o WHERE o.command_id = c.id) AS outbox
      FROM command c WHERE c.id = ${commandId}::uuid`;
  const row = rows[0];
  return { status: row?.status ?? "missing", outboxRows: Number(row?.outbox ?? 0) };
}

export function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
