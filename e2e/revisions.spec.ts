import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// Deep source imports: the @lfsci/db barrel re-exports the migrator, whose
// `import.meta` cannot be loaded by Playwright's CommonJS transpilation.
import { createDb, type DbHandle } from "../packages/db/src/client";
import * as tables from "../packages/db/src/generated/schema";
import { withTenant } from "../packages/db/src/tenant";
import { assertAccessible } from "./helpers/axe";
import {
  closeFixtures,
  commandsOfType,
  organizationIdForEmail,
  seedIrlSeries,
  seedProperty,
} from "./helpers/locations-fixtures";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const YEAR = new Date().getUTCFullYear();

let handle: DbHandle | undefined;

function db(): DbHandle {
  if (!handle) {
    if (!process.env.DATABASE_URL) process.loadEnvFile();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = createDb({ url, max: 2, applicationName: "lfsci-e2e-revisions" });
  }
  return handle;
}

test.afterAll(async () => {
  await handle?.close();
  handle = undefined;
  await closeFixtures();
});

async function signUp(page: Page): Promise<string> {
  const slug = `sci-rev-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const email = `${slug}@example.test`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Révision");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 60_000 });
  return email;
}

async function choose(page: Page, triggerId: string, option: string): Promise<void> {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** IRL-01: an F or G rating freezes the rent in métropole; the DPE lives on the lot. */
async function setEnergyClass(
  organizationId: string,
  unitId: string,
  energyClass: "C" | "G",
): Promise<void> {
  await withTenant(db(), { organizationId }, async (tx) => {
    await tx.update(tables.unit).set({ energyClass }).where(eq(tables.unit.id, unitId));
  });
}

async function createLease(
  page: Page,
  input: { reference: string; unitLabel: string; withClause: boolean },
): Promise<string> {
  await page.goto("/locations/baux/nouveau");
  await page.getByLabel("Nom affiché").fill(`Locataire ${input.reference}`);
  await choose(page, "lease-unit", `${input.unitLabel} · Immeuble d’essai`);
  await page.getByLabel("Référence du bail").fill(input.reference);
  await choose(page, "lease-kind", "Bail nu");
  await page.getByLabel("Date de début").fill(`${YEAR - 1}-01-01`);
  await page.getByLabel("Loyer hors charges").fill("800");
  await page.getByLabel("Montant des charges").fill("60");
  await page.getByLabel("Jour d’exigibilité").fill("5");
  if (input.withClause) {
    await page.getByLabel("Trimestre de référence").fill(`${YEAR - 1}-T1`);
    await page.getByLabel("Mois de révision").fill("1");
  } else {
    await choose(page, "lease-revision-index", "Sans clause");
  }
  await page.getByRole("button", { name: "Créer le bail" }).click();
  await page.waitForURL(/\/locations\/baux\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = /\/locations\/baux\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (!id) throw new Error("lease id not found in the URL");
  return id;
}

test("the revision screen shows the indices, prepares the command and edits the letter", async ({
  page,
}) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  const property = await seedProperty(organizationId);
  await seedIrlSeries(organizationId, [
    { year: YEAR - 1, quarter: 1, value: 143.46 },
    { year: YEAR, quarter: 1, value: 146.12 },
  ]);

  const unitLabel = property.unitLabels[0];
  if (!unitLabel) throw new Error("no unit seeded");
  const leaseId = await createLease(page, {
    reference: "BAIL-REV-001",
    unitLabel,
    withClause: true,
  });

  await page.goto(`/locations/baux/${leaseId}/revisions`);
  await expect(page.getByRole("heading", { name: "Révision du loyer", level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  // IRL-01: both index values, their quarter and the source are on the screen.
  const proposal = page.getByTestId("revision-proposal");
  await expect(proposal).toBeVisible({ timeout: 30_000 });
  await expect(proposal).toContainText("143.46");
  await expect(proposal).toContainText("146.12");
  await expect(proposal).toContainText(`${YEAR - 1}-T1`);
  // 800 × 146,12 / 143,46 = 814,833403… rounded half up to the cent.
  await expect(proposal).toContainText("814,83");
  await expect(proposal).toContainText("814.833403");
  await expect(page.getByText(/n’est pas rétroactive|pour l’avenir/)).toBeVisible();

  await assertAccessible(page, "/locations/baux/[id]/revisions");

  // §17.1: the revision is a level-D decision; nothing is applied on the spot.
  await page.getByTestId("revision-prepare").click();
  await expect
    .poll(async () => (await commandsOfType(organizationId, "revise_rent")).length, {
      timeout: 30_000,
    })
    .toBe(1);
  const [command] = await commandsOfType(organizationId, "revise_rent");
  expect(command?.status).toBe("prepared");
  expect(command?.autonomyLevel).toBe("D");

  // The stored revision keeps the exact quotient, not only the rounded rent.
  const revisions = await withTenant(db(), { organizationId }, async (tx) =>
    tx
      .select({
        proposedRent: tables.rentRevision.proposedRent,
        unrounded: tables.rentRevision.computedRentUnrounded,
        previous: tables.rentRevision.previousIndexValue,
      })
      .from(tables.rentRevision),
  );
  expect(revisions).toHaveLength(1);
  expect(revisions[0]?.proposedRent).toBe("814.83");
  expect(Number(revisions[0]?.unrounded)).toBeCloseTo(814.833403, 5);

  // The notification letter is requested from the history row.
  const letterButton = page.locator('[data-testid^="revision-letter-"]').first();
  await expect(letterButton).toBeVisible({ timeout: 30_000 });
  await letterButton.click();
  await expect
    .poll(
      async () =>
        withTenant(
          db(),
          { organizationId },
          async (tx) =>
            (
              await tx
                .select({ id: tables.document.id })
                .from(tables.document)
                .where(eq(tables.document.nature, "rent_revision_letter"))
            ).length,
        ),
      { timeout: 30_000 },
    )
    .toBe(1);
});

test("a blocked revision says why and offers no executable proposal", async ({
  page,
  isMobile,
}) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  const property = await seedProperty(organizationId);
  await seedIrlSeries(organizationId, [
    { year: YEAR - 1, quarter: 1, value: 143.46 },
    { year: YEAR, quarter: 1, value: 146.12 },
  ]);

  // A lot rated G in métropole: the rent is frozen whatever the index says.
  const frozenUnit = property.unitIds[0];
  const plainUnit = property.unitLabels[1];
  if (!frozenUnit || !plainUnit) throw new Error("no unit seeded");
  await setEnergyClass(organizationId, frozenUnit, "G");

  const leaseLabel = property.unitLabels[0];
  if (!leaseLabel) throw new Error("no unit label");
  const frozenLease = await createLease(page, {
    reference: "BAIL-DPE-G",
    unitLabel: leaseLabel,
    withClause: true,
  });
  await page.goto(`/locations/baux/${frozenLease}/revisions`);
  const blocked = page.getByTestId("revision-blocked");
  await expect(blocked).toBeVisible({ timeout: 30_000 });
  await expect(blocked).toContainText("F ou G");
  // The control stays visible, disabled: the feature never looks absent.
  await expect(page.getByTestId("revision-prepare")).toBeDisabled();
  await expect(page.getByTestId("revision-proposal")).toHaveCount(0);

  // A lease without an indexation clause is blocked for its own reason.
  const noClause = await createLease(page, {
    reference: "BAIL-SANS-CLAUSE",
    unitLabel: plainUnit,
    withClause: false,
  });
  await page.goto(`/locations/baux/${noClause}/revisions`);
  await expect(page.getByTestId("revision-blocked")).toContainText("clause de révision", {
    timeout: 30_000,
  });

  if (isMobile) {
    // The revision tables must stay reachable on a phone, not clipped.
    await expect(page.getByRole("region", { name: "Valeurs d’indice disponibles" })).toBeVisible();
  }

  await assertAccessible(page, "/locations/baux/[id]/revisions (bloquée)");
});
