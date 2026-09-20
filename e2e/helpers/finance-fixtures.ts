import { resolve } from "node:path";
import { eq, ilike } from "drizzle-orm";
// Imported by path, not through "@lfsci/db": the package index re-exports the
// migrator, whose `import.meta` the Playwright CommonJS transform cannot load.
import { createDb, type DbHandle } from "../../packages/db/src/client";
import * as tables from "../../packages/db/src/generated/schema";
import { withTenant } from "../../packages/db/src/tenant";

// The dev server owns the schema; this helper only inserts the patrimoine rows
// the finance and travaux screens need, inside the organization the UI signup
// has just created. Playwright runs from the repository root, where `.env` is.
if (!process.env.DATABASE_URL) {
  process.loadEnvFile(resolve(process.cwd(), ".env"));
}

export type FinanceFixture = {
  organizationId: string;
  legalEntityId: string;
  buildingId: string;
  unitIds: [string, string];
  personId: string;
  ccaId: string;
  bankAccountId: string;
};

let handle: DbHandle | undefined;

function db(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to seed the e2e fixtures");
  if (!handle) handle = createDb({ url, max: 2, applicationName: "lfsci-e2e" });
  return handle;
}

export async function closeFixtures(): Promise<void> {
  const open = handle;
  handle = undefined;
  await open?.close();
}

async function organizationIdOf(slug: string): Promise<string> {
  const rows = await db()
    .db.select({ id: tables.organization.id })
    .from(tables.organization)
    // better-auth mirrors the slug into `code` upper-cased.
    .where(ilike(tables.organization.code, slug))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`organization ${slug} not found; did the sign-up succeed?`);
  return row.id;
}

/** One SCI, one building, two units, a bank account, an associate and his CCA. */
export async function seedPatrimoine(slug: string): Promise<FinanceFixture> {
  const organizationId = await organizationIdOf(slug);

  return withTenant(db(), { organizationId }, async (tx) => {
    const [legalEntity] = await tx
      .insert(tables.legalEntity)
      .values({ organizationId, name: "SCI de démonstration", incomeTaxRegime: "is" })
      .returning({ id: tables.legalEntity.id });
    if (!legalEntity) throw new Error("legal_entity insert returned no row");

    const [building] = await tx
      .insert(tables.building)
      .values({
        organizationId,
        legalEntityId: legalEntity.id,
        code: "IMM-1",
        name: "Immeuble Demo",
        addressLine1: "1 rue de la Démonstration",
        postalCode: "64000",
        city: "Pau",
      })
      .returning({ id: tables.building.id });
    if (!building) throw new Error("building insert returned no row");

    const units = await tx
      .insert(tables.unit)
      .values([
        {
          organizationId,
          buildingId: building.id,
          code: "A1",
          label: "Appartement A1",
          kind: "dwelling",
        },
        {
          organizationId,
          buildingId: building.id,
          code: "A2",
          label: "Appartement A2",
          kind: "dwelling",
        },
      ])
      .returning({ id: tables.unit.id });
    const [unitA, unitB] = units;
    if (!unitA || !unitB) throw new Error("unit insert returned no rows");

    const [bankAccount] = await tx
      .insert(tables.bankAccount)
      .values({
        organizationId,
        legalEntityId: legalEntity.id,
        label: "Compte courant SCI",
        bankName: "Banque de démonstration",
        openingBalance: "10000.00",
        openingBalanceOn: "2026-01-01",
      })
      .returning({ id: tables.bankAccount.id });
    if (!bankAccount) throw new Error("bank_account insert returned no row");

    const [person] = await tx
      .insert(tables.person)
      .values({ organizationId, displayName: "Associé Démo" })
      .returning({ id: tables.person.id });
    if (!person) throw new Error("person insert returned no row");

    const [cca] = await tx
      .insert(tables.partnerCurrentAccount)
      .values({
        organizationId,
        legalEntityId: legalEntity.id,
        partnerPersonId: person.id,
      })
      .returning({ id: tables.partnerCurrentAccount.id });
    if (!cca) throw new Error("partner_current_account insert returned no row");

    return {
      organizationId,
      legalEntityId: legalEntity.id,
      buildingId: building.id,
      unitIds: [unitA.id, unitB.id],
      personId: person.id,
      ccaId: cca.id,
      bankAccountId: bankAccount.id,
    };
  });
}

export async function countPreparedCommands(
  organizationId: string,
  commandType: string,
): Promise<number> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const rows = await tx
      .select({ status: tables.command.status })
      .from(tables.command)
      .where(eq(tables.command.commandType, commandType));
    return rows.filter((row) => row.status === "prepared").length;
  });
}

export async function eventTypesOf(
  organizationId: string,
  objectKind: "intervention" | "meter" | "expense",
  objectId: string,
): Promise<string[]> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const column =
      objectKind === "intervention"
        ? tables.objectRef.interventionId
        : objectKind === "meter"
          ? tables.objectRef.meterId
          : tables.objectRef.expenseId;
    const rows = await tx
      .select({ type: tables.event.type })
      .from(tables.event)
      .innerJoin(tables.objectRef, eq(tables.event.primaryObjectRefId, tables.objectRef.id))
      .where(eq(column, objectId));
    return rows.map((row) => row.type);
  });
}

/** Proves what the allocation transaction actually wrote, not what it rendered. */
export async function allocationAmountsOf(
  organizationId: string,
): Promise<{ amount: string; unitId: string | null }[]> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const rows = await tx
      .select({ amount: tables.expenseAllocation.amount, unitId: tables.expenseAllocation.unitId })
      .from(tables.expenseAllocation);
    return rows.sort((a, b) => b.amount.localeCompare(a.amount));
  });
}

export async function loanInstallmentCount(organizationId: string): Promise<number> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const rows = await tx.select({ id: tables.loanInstallment.id }).from(tables.loanInstallment);
    return rows.length;
  });
}
