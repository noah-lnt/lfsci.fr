import { expect, type Page, test } from "@playwright/test";
import { assertAccessible } from "./helpers/axe";
import { closeFixtures, organizationIdForEmail, seedProperty } from "./helpers/locations-fixtures";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

/** EDL-03: the deadline is counted from this handover, so it is fixed here. */
const KEYS_HANDED_OVER_ON = "2026-09-10";
const ENTRY_ON = "2026-01-15";
const EXIT_ON = "2026-09-09";

test.afterAll(async () => {
  await closeFixtures();
});

async function choose(page: Page, triggerId: string, option: string): Promise<void> {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function signUp(page: Page): Promise<string> {
  const slug = `edl-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const email = `${slug}@example.test`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire État des lieux");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 60_000 });
  return email;
}

/** One lease with a unit and a 900 € deposit actually received. */
async function seedLease(page: Page, unitLabel: string): Promise<string> {
  await page.goto("/locations/baux/nouveau");
  await page.getByLabel("Nom affiché").fill("Camille Martin");
  await choose(page, "lease-unit", `${unitLabel} · Immeuble d’essai`);
  await page.getByLabel("Référence du bail").fill("BAIL-EDL-001");
  await choose(page, "lease-kind", "Bail meublé");
  await page.getByLabel("Date de début").fill("2026-01-15");
  await page.getByLabel("Loyer hors charges").fill("900");
  await page.getByLabel("Montant des charges").fill("60");
  await page.getByLabel("Jour d’exigibilité").fill("5");
  await page.getByLabel("Dépôt de garantie").fill("900");
  await choose(page, "lease-revision-index", "Sans clause");
  await page.getByRole("button", { name: "Créer le bail" }).click();
  await page.waitForURL(/\/locations\/baux\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const leaseId = page.url().split("/").at(-1) ?? "";

  await page.getByRole("tab", { name: "Dépôt" }).click();
  await page.locator("#deposit-amount").fill("900");
  await page.locator("#deposit-occurred-on").fill("2026-01-15");
  await page.getByRole("button", { name: "Enregistrer le mouvement" }).click();
  // The lease summary already prints the deposit amount, so only the toast
  // proves the movement itself reached the server before the page moves on.
  await expect(page.getByText("Mouvement enregistré.")).toBeVisible({ timeout: 20_000 });

  return leaseId;
}

async function addFinding(
  page: Page,
  room: string,
  element: string,
  condition: string,
): Promise<void> {
  await page.getByLabel("Pièce", { exact: true }).fill(room);
  await page.getByLabel("Élément", { exact: true }).fill(element);
  await choose(page, "finding-new-condition", condition);
  await page.getByRole("button", { name: "Ajouter le constat" }).click();
  await expect(page.getByRole("heading", { name: room, level: 3 })).toBeVisible({
    timeout: 20_000,
  });
}

async function openInspection(page: Page, leaseId: string, kind: string, on: string) {
  await page.goto(`/locations/baux/${leaseId}/etats-des-lieux`);
  await choose(page, "inspection-kind", kind);
  await page.getByLabel("Date de la visite", { exact: true }).first().fill(on);
  await page.getByRole("button", { name: "Ouvrir la visite" }).click();
  await page.waitForURL(/\/etats-des-lieux\/[0-9a-f-]{36}$/, { timeout: 60_000 });
}

test("an entry visit, an exit visit, the prepared differences and the deposit restitution", async ({
  page,
}) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  const property = await seedProperty(organizationId);
  const unitLabel = property.unitLabels[0] ?? "Appartement A1";
  const leaseId = await seedLease(page, unitLabel);

  // --- 1. The list says what the module holds before anything exists --------
  await page.goto(`/locations/baux/${leaseId}/etats-des-lieux`);
  await expect(page.getByRole("heading", { name: "États des lieux", level: 1 })).toBeVisible();
  await expect(page.getByText(/Aucun état des lieux pour ce bail/)).toBeVisible();
  await assertAccessible(page, "/locations/baux/[id]/etats-des-lieux");

  // --- 2. EDL-01: the entry visit, room by room ----------------------------
  await openInspection(page, leaseId, "Entrée", ENTRY_ON);
  await addFinding(page, "Séjour", "Mur nord", "Dégradé");
  await addFinding(page, "Cuisine", "Plan de travail", "Bon");
  await expect(page.getByTestId("finding-card")).toHaveCount(2);

  // EDL-02: the furnished inventory is a separate list on the same visit.
  await page.getByLabel("Catégorie").fill("Cuisine");
  await page.getByLabel("Désignation").fill("Table");
  await page.getByRole("button", { name: "Ajouter la ligne" }).click();
  await expect(page.getByTestId("inventory-row")).toHaveCount(1, { timeout: 20_000 });
  await page.getByLabel("Présent à l’entrée — Table", { exact: true }).click();
  await page.getByRole("option", { name: "Oui", exact: true }).click();

  await assertAccessible(page, "capture entrée");

  // EDL-01: signing opens the ten-day complement window and seals the visit.
  await page.getByTestId("sign-inspection").click();
  await expect(page.getByTestId("inspection-status")).toHaveText("Signé", { timeout: 20_000 });
  await expect(page.getByTestId("complement-notice")).toContainText("2026-01-25");

  // --- 3. The exit visit: one defect already present, one new --------------
  await openInspection(page, leaseId, "Sortie", EXIT_ON);
  await page.getByLabel("Remise des clés").fill(KEYS_HANDED_OVER_ON);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();

  await addFinding(page, "Séjour", "Mur nord", "Dégradé");
  await addFinding(page, "Cuisine", "Plan de travail", "Dégradé");

  await page.getByLabel("Présent à la sortie — Table", { exact: true }).click();
  await page.getByRole("option", { name: "Non", exact: true }).click();

  await assertAccessible(page, "capture sortie");

  // --- 4. EDL-03: only the new defect is proposed to review ----------------
  await page.goto(`/locations/baux/${leaseId}/etats-des-lieux/comparaison`);
  await expect(page.getByTestId("comparison-proposed")).toContainText("1", { timeout: 20_000 });
  await expect(page.getByTestId("comparison-conformity")).toContainText(
    "La sortie diffère de l’entrée.",
  );
  const reviewFlags = page.getByTestId("difference-review");
  await expect(reviewFlags).toHaveCount(2);
  await expect(reviewFlags.filter({ hasText: "Oui" })).toHaveCount(1);
  await assertAccessible(page, "/locations/baux/[id]/etats-des-lieux/comparaison");

  // --- 5. EDL-02: the missing item withholds nothing by itself -------------
  await page.goto(`/locations/baux/${leaseId}/etats-des-lieux/restitution`);
  await expect(page.getByTestId("no-deduction")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("missing-inventory-hint")).toBeVisible();
  await expect(page.getByTestId("settlement-restitution")).toContainText("900,00 €");
  // Two months: the exit does not match the entry, counted from the handover.
  await expect(page.getByTestId("settlement-deadline")).toContainText("10/11/2026");
  await expect(page.getByTestId("settlement-blocked")).toHaveCount(0);
  await assertAccessible(page, "/locations/baux/[id]/etats-des-lieux/restitution");
});
