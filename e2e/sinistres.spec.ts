import { expect, type Page, test } from "@playwright/test";
// Imported by path, not through "@lfsci/db": the package index re-exports the
// migrator, whose `import.meta` the Playwright CommonJS transform cannot load.
import { createDb, type DbHandle } from "../packages/db/src/client";
import * as tables from "../packages/db/src/generated/schema";
import { withTenant } from "../packages/db/src/tenant";
import { assertAccessible } from "./helpers/axe";
import { closeFixtures, type FinanceFixture, seedPatrimoine } from "./helpers/finance-fixtures";

const INTERVENTION = "Réparation dégât des eaux";

test.use({ reducedMotion: "reduce" });

let handle: DbHandle | undefined;

function db(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to seed the e2e fixtures");
  if (!handle) handle = createDb({ url, max: 2, applicationName: "lfsci-e2e-sinistres" });
  return handle;
}

test.afterAll(async () => {
  const open = handle;
  handle = undefined;
  await open?.close();
  await closeFixtures();
});

async function signUp(page: Page): Promise<string> {
  const slug = `sin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Sinistres");
  await page.getByLabel("Adresse e-mail").fill(`${slug}@example.test`);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
  return slug;
}

async function pick(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** The repair side of the claim: one intervention carrying two supplier invoices. */
async function seedRepairs(fixture: FinanceFixture): Promise<void> {
  const organizationId = fixture.organizationId;
  await withTenant(db(), { organizationId }, async (tx) => {
    const [intervention] = await tx
      .insert(tables.intervention)
      .values({
        organizationId,
        title: INTERVENTION,
        urgency: "high",
        performedBy: "supplier",
        buildingId: fixture.buildingId,
        unitId: fixture.unitIds[0],
        reportedOn: "2026-09-02",
        status: "done",
        completedOn: "2026-09-10",
        observedResult: "Toiture reprise, plafond sec après contrôle.",
      })
      .returning({ id: tables.intervention.id });
    if (!intervention) throw new Error("intervention insert returned no row");

    await tx.insert(tables.expense).values([
      {
        organizationId,
        legalEntityId: fixture.legalEntityId,
        interventionId: intervention.id,
        documentKind: "invoice",
        issuedOn: "2026-09-11",
        totalInclTax: "420.00",
        status: "validated",
      },
      {
        organizationId,
        legalEntityId: fixture.legalEntityId,
        interventionId: intervention.id,
        documentKind: "invoice",
        issuedOn: "2026-09-12",
        totalInclTax: "80.50",
        status: "validated",
      },
    ]);
  });
}

/**
 * SIN-01: an indemnity is cash seen in the ledger. Until the Odoo back-sync
 * writes these rows, the only way to have one is to insert it, which is exactly
 * what the screen says it cannot do by hand.
 */
async function seedIndemnity(organizationId: string, claimId: string): Promise<void> {
  await withTenant(db(), { organizationId }, async (tx) => {
    await tx.insert(tables.claimIndemnity).values({
      organizationId,
      claimId,
      amount: "300.00",
      receivedOn: "2026-09-18",
      kind: "final",
    });
  });
}

test("the owner declares a claim, attaches its repairs, and reads the balance against the indemnity", async ({
  page,
}) => {
  test.slow();
  const slug = await signUp(page);
  const fixture = await seedPatrimoine(slug);

  // --- SIN-01: the declaration, facts and alleged liability apart -----------
  await page.goto("/travaux/sinistres");
  await pick(page, "Lot touché", "A1 — Appartement A1");
  await page.getByLabel("Référence interne").fill("SIN-2026-01");
  await page.getByLabel("Date des faits").fill("2026-09-01");
  await page.getByLabel("Date de déclaration").fill("2026-09-03");
  await page.getByLabel("Échéance à tenir").fill("2026-10-01");
  await page
    .getByLabel("Faits", { exact: true })
    .fill("Fuite en toiture, plafond de la chambre détrempé.");
  await page
    .getByLabel("Responsabilité alléguée")
    .fill("Le locataire met en cause la couverture de l’immeuble.");
  await expect(page.getByLabel("Référence interne")).toHaveValue("SIN-2026-01");
  await page.getByRole("button", { name: "Déclarer", exact: true }).click();

  await page.waitForURL(/\/travaux\/sinistres\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const claimId = page.url().split("/").at(-1) ?? "";
  expect(claimId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByTestId("claim-status")).toHaveText("Déclaré");
  await expect(page.getByTestId("claim-alleged")).toContainText("couverture de l’immeuble");
  await expect(page.getByTestId("claim-acknowledged")).toHaveText("—");
  await expect(page.getByTestId("claim-grossCost")).toContainText("0,00");

  // --- SIN-01: the repairs reach the claim through their intervention -------
  await seedRepairs(fixture);
  await page.reload();
  await pick(page, "Intervention", INTERVENTION);
  await page.getByRole("button", { name: "Rattacher une intervention" }).click();
  await expect(page.getByTestId("claim-expenses")).toContainText(INTERVENTION, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("claim-grossCost")).toContainText("500,50");

  // The deductible and what the insurer announced are owner-entered figures.
  await page.getByLabel("Indemnité attendue").fill("450,00");
  await page.getByLabel("Franchise appliquée").fill("150,00");
  await pick(page, "Statut", "Ouvert");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByTestId("claim-status")).toHaveText("Ouvert", { timeout: 20_000 });
  await expect(page.getByTestId("claim-deductible")).toContainText("150,00");

  // --- SIN-01: no manual indemnity, and no netting of the gross amounts -----
  await expect(page.getByTestId("claim-no-indemnity")).toBeVisible();
  await expect(page.getByRole("button", { name: "Saisie manuelle impossible" })).toBeDisabled();
  await assertAccessible(page, "/travaux/sinistres/[id]");

  await seedIndemnity(fixture.organizationId, claimId);
  await page.reload();
  await expect(page.getByTestId("claim-indemnities")).toContainText("300,00", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("claim-grossCost")).toContainText("500,50");
  await expect(page.getByTestId("claim-grossIndemnities")).toContainText("300,00");
  await expect(page.getByTestId("claim-remaining")).toContainText("200,50");
  await expect(page.getByTestId("claim-stillExpected")).toContainText("150,00");

  await page.goto("/travaux/sinistres");
  await expect(page.getByRole("link", { name: "SIN-2026-01" })).toBeVisible({ timeout: 20_000 });
  await assertAccessible(page, "/travaux/sinistres");
});
