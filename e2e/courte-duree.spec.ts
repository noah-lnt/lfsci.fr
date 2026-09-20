import { expect, type Page, test } from "@playwright/test";
import { assertAccessible } from "./helpers/axe";
import { closeFixtures, organizationIdForEmail, seedProperty } from "./helpers/locations-fixtures";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.afterAll(async () => {
  await closeFixtures();
});

/** AIR-02: the same columns, in an order the mapping never reads. */
const RESERVATIONS_CSV = [
  "Voyageur,Départ,Code de confirmation,Arrivée,Hébergement,Frais de ménage,Frais de service,Remboursement,Taxe de séjour collectée,Taxe de séjour reversée,Versement,Date de versement,Montant versé",
  "Camille Martin,2026-07-19,HMTEST1,2026-07-14,820.00,70.00,26.70,0.00,24.00,24.00,PAY-E2E-1,2026-07-25,1309.50",
  "Dominique Leroy,2026-08-04,HMTEST2,2026-08-01,540.00,70.00,13.80,150.00,16.00,16.00,PAY-E2E-1,2026-07-25,1309.50",
  "",
].join("\n");

async function choose(page: Page, triggerId: string, option: string): Promise<void> {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function signUp(page: Page): Promise<string> {
  const slug = `sci-cd-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
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

async function uploadReservations(page: Page): Promise<void> {
  await page.getByLabel("Fichier CSV", { exact: true }).setInputFiles({
    name: "reservations.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(RESERVATIONS_CSV, "utf8"),
  });
}

test("a listing, a stay, an import and a payout go through the module", async ({ page }) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  const property = await seedProperty(organizationId);

  // 1. AIR-01: the empty screen says what the module holds and warns about iCal.
  await page.goto("/locations/courte-duree");
  await expect(page.getByRole("heading", { name: "Courte durée", level: 1 })).toBeVisible();
  await expect(page.getByTestId("model-notice")).toContainText(/trois objets distincts/i);
  await expect(page.getByTestId("ical-notice")).toContainText(
    /latence interdit de garantir l’absence de double réservation/,
  );
  await expect(page.getByText(/Aucune annonce/)).toBeVisible();
  await assertAccessible(page, "/locations/courte-duree");

  // 2. One form creates the listing with its registration formality.
  await choose(page, "listing-unit", `L01 — ${property.unitLabels[0]}`);
  await choose(page, "listing-platform", "Airbnb");
  await page.getByLabel("Titre de l’annonce", { exact: true }).fill("Studio Vue Mer");
  await page.getByLabel("Identifiant plateforme", { exact: true }).fill("AIRBNB-1");
  await page
    .getByLabel("Adresse iCal à lire", { exact: true })
    .fill("https://calendar.example.test/feed.ics");
  await page.getByLabel("Numéro d’enregistrement", { exact: true }).fill("64445000123AB");
  await page.getByLabel("Contrôlé le", { exact: true }).first().fill("2026-01-15");
  await page.getByRole("button", { name: "Créer l’annonce" }).click();
  await expect(page.getByTestId("listing-row")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("listing-status")).toHaveText("Active");
  // AIR-03: a feed that was never polled says so instead of implying freshness.
  await expect(page.getByTestId("listing-row")).toContainText("Jamais synchronisé");

  // 3. The listing is editable and archivable by status (house CRUD).
  await page.getByTestId("listing-edit").click();
  await page
    .getByLabel("Titre de l’annonce", { exact: true })
    .last()
    .fill("Studio Vue Mer — rénové");
  await page.getByTestId("listing-save").click();
  await expect(page.getByTestId("listing-row")).toContainText("Studio Vue Mer — rénové", {
    timeout: 20_000,
  });

  // 4. A stay entered by hand shows up in the month calendar.
  await page.goto("/locations/courte-duree/reservations");
  await expect(page.getByTestId("booking-calendar")).toBeVisible();
  await choose(page, "booking-listing", "Studio Vue Mer — rénové");
  await page.getByLabel("Code de confirmation", { exact: true }).fill("MANUEL-1");
  await page.getByLabel("Voyageur", { exact: true }).fill("Alex Durand");
  await page.getByLabel("Arrivée", { exact: true }).fill("2026-09-10");
  await page.getByLabel("Départ", { exact: true }).fill("2026-09-13");
  await page.getByLabel("Hébergement", { exact: true }).fill("300.00");
  await page.getByRole("button", { name: "Créer la réservation" }).click();
  await expect(page.getByTestId("booking-row")).toHaveCount(1, { timeout: 20_000 });
  await assertAccessible(page, "/locations/courte-duree/reservations");

  // 5. A booking, a stay and a payout stay three distinct objects on the detail.
  await page.getByRole("link", { name: "MANUEL-1" }).click();
  await page.waitForURL(/\/locations\/courte-duree\/reservations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("booking-money")).toBeVisible();
  await page.getByRole("tab", { name: "Séjour" }).click();
  await expect(page.getByTestId("booking-stay")).toContainText("Appartement A1");
  await page.getByRole("tab", { name: "Versements" }).click();
  await expect(page.getByText(/Aucun versement ne règle encore/)).toBeVisible();
  await page.getByRole("tab", { name: "Mouvements" }).click();
  await expect(page.getByTestId("movement-row")).toHaveCount(1);

  // 6. AIR-02: the file is mapped by header name and previewed before any write.
  await page.goto("/locations/courte-duree/import");
  await choose(page, "import-mapping", "Générique — réservations, dates ISO · Réservations");
  await uploadReservations(page);
  await choose(page, "import-listing", "Studio Vue Mer — rénové");
  await choose(page, "import-legal-entity", "SCI de démonstration");
  await page.getByLabel("Total annoncé par la plateforme", { exact: true }).fill("1309.50");
  await page.getByTestId("import-preview").click();
  await expect(page.getByTestId("import-preview-panel")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("import-row-count")).toHaveText("2");
  await expect(page.getByTestId("import-new-count")).toHaveText("2");
  await expect(page.getByTestId("import-duplicate-count")).toHaveText("0");
  await expect(page.getByTestId("import-missing-columns")).toHaveText("—");
  await expect(page.getByTestId("import-blocked")).toHaveCount(0);
  await assertAccessible(page, "/locations/courte-duree/import");

  // 7. The grouped transfer is reconstructed, refunds and taxes kept apart.
  await expect(page.getByTestId("reconciliation-expected")).toHaveText(/1\s309,50/);
  await expect(page.getByTestId("reconciliation-difference")).toHaveText(/^0,00/);
  await expect(page.getByTestId("reconciliation-verdict")).toHaveText("Rapprochement exact");
  await expect(page.getByTestId("reconciliation-line")).toHaveCount(2);

  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-result")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("result-bookings")).toHaveText("2");

  // 8. Importing the same file again writes nothing.
  await uploadReservations(page);
  await page.getByTestId("import-preview").click();
  await expect(page.getByTestId("import-duplicate-count")).toHaveText("2", { timeout: 20_000 });
  await expect(page.getByTestId("import-new-count")).toHaveText("0");
  await expect(page.getByTestId("import-nothing")).toBeVisible();
  await expect(page.getByTestId("import-commit")).toBeDisabled();

  // 9. The payout is reconciled and only then confirmable.
  await page.goto("/locations/courte-duree/versements");
  await expect(page.getByTestId("payout-row")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("payout-status")).toHaveText("Rapproché");
  await page.getByTestId("payout-open").click();
  await expect(page.getByTestId("payout-detail")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("reconciliation-verdict")).toHaveText("Rapprochement exact");
  await expect(page.getByTestId("payout-detail-row")).toHaveCount(2);
  await expect(page.getByTestId("payout-confirm")).toBeEnabled();
  await page.getByTestId("payout-confirm").click();
  await expect(page.getByTestId("payout-status")).toHaveText("Confirmé", { timeout: 20_000 });
  await assertAccessible(page, "/locations/courte-duree/versements");
});

test("a file whose total does not match is refused before any write", async ({ page }) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  await seedProperty(organizationId);

  await page.goto("/locations/courte-duree/import");
  await choose(page, "import-mapping", "Générique — réservations, dates ISO · Réservations");
  await uploadReservations(page);
  await page.getByLabel("Total annoncé par la plateforme", { exact: true }).fill("1000.00");
  await page.getByTestId("import-preview").click();
  await expect(page.getByTestId("import-blocked")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("import-blocked")).toContainText(
    "Le total annoncé ne correspond pas à la somme du fichier.",
  );
  await expect(page.getByTestId("import-total-difference")).toHaveText(/309,50/);
  await expect(page.getByTestId("import-commit")).toBeDisabled();
});

test("a file missing a required column names it instead of guessing a position", async ({
  page,
}) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  await seedProperty(organizationId);

  await page.goto("/locations/courte-duree/import");
  await choose(page, "import-mapping", "Générique — réservations, dates ISO · Réservations");
  await page.getByLabel("Fichier CSV", { exact: true }).setInputFiles({
    name: "sans-code.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      RESERVATIONS_CSV.replace("Code de confirmation", "Identifiant interne"),
      "utf8",
    ),
  });
  await page.getByTestId("import-preview").click();
  await expect(page.getByTestId("import-missing-columns")).toHaveText("Code de confirmation", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("import-blocked")).toBeVisible();
  await expect(page.getByTestId("import-commit")).toBeDisabled();
});
