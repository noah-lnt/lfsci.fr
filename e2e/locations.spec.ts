import { expect, type Page, test } from "@playwright/test";
import { assertAccessible } from "./helpers/axe";
import {
  closeFixtures,
  commandsOfType,
  organizationIdForEmail,
  seedIrlSeries,
  seedProperty,
} from "./helpers/locations-fixtures";

const _SERIOUS = new Set(["serious", "critical"]);

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.afterAll(async () => {
  await closeFixtures();
});

async function choose(page: Page, triggerId: string, option: string): Promise<void> {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function signUp(page: Page): Promise<string> {
  const slug = `sci-loc-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const email = `${slug}@example.test`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Test");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 60_000 });
  return email;
}

function firstOfThisMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

test("a lease goes from creation to quittance", async ({ page }) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  const property = await seedProperty(organizationId);
  const year = new Date().getUTCFullYear();
  await seedIrlSeries(organizationId, [
    { year: year - 1, quarter: 1, value: 143.46 },
    { year, quarter: 1, value: 146.0 },
  ]);

  // 1. The empty screen says what the module will hold.
  await page.goto("/locations");
  await expect(page.getByRole("heading", { name: "Locations", level: 1 })).toBeVisible();
  await expect(page.getByText(/Aucun bail enregistré/)).toBeVisible();
  await assertAccessible(page, "/locations");

  // 2. One form: tenant, unit, dates, rent, deposit and revision clause.
  await page.getByRole("link", { name: "Nouveau bail" }).click();
  await page.waitForURL(/\/locations\/baux\/nouveau$/);
  await page.getByLabel("Nom affiché").fill("Camille Martin");
  await page.getByLabel("Adresse e-mail").fill("camille.martin@example.test");
  await choose(page, "lease-unit", `${property.unitLabels[0]} · Immeuble d’essai`);
  await page.getByLabel("Référence du bail").fill("BAIL-2026-001");
  await choose(page, "lease-kind", "Bail nu");
  await page.getByLabel("Date de début").fill(firstOfThisMonth());
  await page.getByLabel("Loyer hors charges").fill("900");
  await page.getByLabel("Montant des charges").fill("60");
  await page.getByLabel("Jour d’exigibilité").fill("5");
  await page.getByLabel("Dépôt de garantie").fill("900");
  await page.getByLabel("Trimestre de référence").fill(`${year - 1}-T1`);
  await page.getByLabel("Mois de révision").fill("1");
  await page.getByRole("button", { name: "Créer le bail" }).click();
  await page.waitForURL(/\/locations\/baux\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("lease-status")).toHaveText("Brouillon");
  await expect(page.getByTestId("missing-pieces")).toHaveCount(0);

  // 3. Draft → ready to sign → signed → active (spec §13.3).
  for (const [target, label] of [
    ["Prêt à signer", "Prêt à signer"],
    ["Signé", "Signé"],
    ["Actif", "Actif"],
  ] as const) {
    await choose(page, "lease-transition", target);
    await page.getByTestId("lease-transition-apply").click();
    await expect(page.getByTestId("lease-status")).toHaveText(label, { timeout: 20_000 });
  }

  // 4. LOY-01: the engine prepares the next three months, once.
  await page.getByRole("tab", { name: "Loyers" }).click();
  await page.getByRole("button", { name: "Générer les termes" }).click();
  await expect(page.getByTestId("term-row")).toHaveCount(3, { timeout: 20_000 });

  // 5. LOY-02: a partial payment is allocated explicitly.
  await page.getByRole("tab", { name: "Paiements" }).click();
  await page.getByLabel("Montant reçu").fill("500");
  await page.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(1, { timeout: 20_000 });
  await page.locator('[data-testid="allocate-open"]:not([disabled])').first().click();
  await page.getByTestId("allocate-amount").first().fill("500");
  await page.getByRole("button", { name: "Valider l’affectation" }).click();
  await expect(page.getByTestId("payment-row").first().getByTestId("allocate-open")).toBeDisabled({
    timeout: 20_000,
  });

  // 6. LOY-03: a partly settled term only offers a reçu.
  await page.getByRole("tab", { name: "Loyers" }).click();
  await expect(page.getByTestId("term-row").first().getByTestId("issue-recu")).toBeVisible();

  // 7. The balance settles the term; the quittance becomes possible.
  await page.getByRole("tab", { name: "Paiements" }).click();
  await page.getByLabel("Montant reçu").fill("460");
  await page.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(page.getByTestId("payment-row")).toHaveCount(2, { timeout: 20_000 });
  await page.locator('[data-testid="allocate-open"]:not([disabled])').first().click();
  await page.getByTestId("allocate-amount").first().fill("460");
  await page.getByRole("button", { name: "Valider l’affectation" }).click();

  await page.getByRole("tab", { name: "Loyers" }).click();
  const quittance = page.getByTestId("term-row").first().getByTestId("issue-quittance");
  await expect(quittance).toBeVisible({ timeout: 20_000 });
  await quittance.click();

  // The receipt command is prepared (level B) and waits for the worker.
  await expect
    .poll(async () => (await commandsOfType(organizationId, "issue_receipt")).length, {
      timeout: 20_000,
    })
    .toBe(1);
  const [command] = await commandsOfType(organizationId, "issue_receipt");
  expect(command?.status).toBe("prepared");
  expect(command?.autonomyLevel).toBe("B");

  // 8. IRL-01: the proposal is computed, or its blocking reason is shown.
  await page.getByRole("tab", { name: "Révision" }).click();
  await expect(
    page.getByTestId("revision-proposal").or(page.getByTestId("revision-blocked")),
  ).toBeVisible({ timeout: 20_000 });

  await assertAccessible(page, "fiche bail");
});

test("the tenant list shows the tenant created with the lease", async ({ page }) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  await seedProperty(organizationId);

  await page.goto("/locations/locataires");
  await expect(page.getByRole("heading", { name: "Locataires", level: 1 })).toBeVisible();
  // A slow runner can reach the form before React hydrates it; wait for the page to settle.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nom affiché").fill("Dominique Leroy");
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/persons/create")),
    page.getByRole("button", { name: "Créer le locataire" }).click(),
  ]);
  expect(created.ok()).toBe(true);
  await expect(page.getByRole("link", { name: "Dominique Leroy" })).toBeVisible({
    timeout: 20_000,
  });
  await assertAccessible(page, "/locations/locataires");
});
