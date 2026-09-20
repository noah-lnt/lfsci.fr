import { eq } from "drizzle-orm";
// Deep source imports: the @lfsci/db barrel re-exports the migrator, whose
// `import.meta` cannot be loaded by Playwright's CommonJS transpilation.
import { hashPayload } from "../../packages/db/src/canonical";
import { createDb, type DbHandle } from "../../packages/db/src/client";
import * as tables from "../../packages/db/src/generated/schema";
import { withTenant } from "../../packages/db/src/tenant";

let handle: DbHandle | undefined;

function db(): DbHandle {
  if (!handle) {
    // The dev server and the tests share one .env; the fixtures read the same DSN.
    process.loadEnvFile();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = createDb({ url, max: 2, applicationName: "lfsci-e2e" });
  }
  return handle;
}

export async function closeFixtures(): Promise<void> {
  if (handle) await handle.close();
  handle = undefined;
}

/** The signup mirrors auth_user → app_user → membership with the same ids. */
export async function organizationIdForEmail(email: string): Promise<string> {
  const rows = await db().sql<{ organization_id: string }[]>`
    SELECT m.organization_id
    FROM membership m
    JOIN app_user u ON u.id = m.app_user_id
    WHERE u.email = ${email}
    LIMIT 1
  `;
  const id = rows[0]?.organization_id;
  if (!id) throw new Error(`no organization for ${email}`);
  return id;
}

export type SeededProperty = {
  legalEntityId: string;
  buildingId: string;
  unitIds: string[];
  unitLabels: string[];
};

export async function seedProperty(organizationId: string): Promise<SeededProperty> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const entities = await tx
      .insert(tables.legalEntity)
      .values({
        organizationId,
        name: "SCI de démonstration",
        legalForm: "sci",
        status: "active",
      })
      .returning({ id: tables.legalEntity.id });
    const legalEntityId = entities[0]?.id;
    if (!legalEntityId) throw new Error("legal entity not inserted");

    const buildings = await tx
      .insert(tables.building)
      .values({
        organizationId,
        legalEntityId,
        code: "IMM-1",
        name: "Immeuble d’essai",
        addressLine1: "1 rue de l’Exemple",
        postalCode: "64000",
        city: "Pau",
        status: "active",
      })
      .returning({ id: tables.building.id });
    const buildingId = buildings[0]?.id;
    if (!buildingId) throw new Error("building not inserted");

    const unitLabels = ["Appartement A1", "Appartement A2"];
    const units = await tx
      .insert(tables.unit)
      .values(
        unitLabels.map((label, index) => ({
          organizationId,
          buildingId,
          code: `L0${index + 1}`,
          label,
          kind: "dwelling",
          energyClass: "C",
          status: "active",
        })),
      )
      .returning({ id: tables.unit.id });

    return { legalEntityId, buildingId, unitIds: units.map((unit) => unit.id), unitLabels };
  });
}

/** IRL-01: the revision reads the index series stored as a versioned rule. */
export async function seedIrlSeries(
  organizationId: string,
  observations: { year: number; quarter: number; value: number }[],
): Promise<void> {
  await withTenant(db(), { organizationId }, async (tx) => {
    const rules = await tx
      .insert(tables.rule)
      .values({
        organizationId,
        code: "irl_index",
        domain: "rent_indexation",
        label: "Indice de référence des loyers (INSEE)",
        origin: "template",
        status: "active",
      })
      .returning({ id: tables.rule.id });
    const ruleId = rules[0]?.id;
    if (!ruleId) throw new Error("rule not inserted");

    const definition = { series: "irl", observations };
    await tx.insert(tables.ruleVersion).values({
      organizationId,
      ruleId,
      sequence: 1,
      definition,
      definitionHash: hashPayload(definition),
      effectiveFrom: new Date().toISOString().slice(0, 10),
      status: "active",
    });
  });
}

export async function commandsOfType(
  organizationId: string,
  commandType: string,
): Promise<{ id: string; status: string; autonomyLevel: string }[]> {
  return withTenant(db(), { organizationId }, async (tx) =>
    tx
      .select({
        id: tables.command.id,
        status: tables.command.status,
        autonomyLevel: tables.command.autonomyLevel,
      })
      .from(tables.command)
      .where(eq(tables.command.commandType, commandType)),
  );
}

export async function receiptCount(organizationId: string): Promise<number> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const rows = await tx.select({ id: tables.rentReceipt.id }).from(tables.rentReceipt);
    return rows.length;
  });
}
