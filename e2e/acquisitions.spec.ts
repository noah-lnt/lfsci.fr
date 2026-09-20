import { expect, type Page, test } from "@playwright/test";
import { assertAccessible } from "./helpers/axe";
import {
  closeFixtures,
  conversionSnapshot,
  countPreparedCommands,
  seedPatrimoine,
} from "./helpers/finance-fixtures";

test.use({ reducedMotion: "reduce" });

test.afterAll(async () => {
  await closeFixtures();
});

async function signUp(page: Page): Promise<string> {
  const slug = `acq-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Acquisitions");
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

test("the owner studies an opportunity, then converts it exactly once", async ({ page }) => {
  test.slow();
  const slug = await signUp(page);
  const fixture = await seedPatrimoine(slug);
  const before = await conversionSnapshot(fixture.organizationId);

  // --- ACQ-01: price, fees, works, expected rent ----------------------------
  await page.goto("/finance/acquisitions/nouvelle");
  await page.getByLabel("Libellé", { exact: true }).fill("Immeuble Bellevue");
  await pick(page, "SCI acquéreuse", "SCI de démonstration");
  await page.getByLabel("Adresse").fill("2 rue de la Démonstration");
  await page.getByLabel("Commune").fill("Pau");
  await page.getByLabel("Prix demandé").fill("200000,00");
  await page.getByLabel("Frais estimés").fill("16000,00");
  await page.getByLabel("Travaux estimés").fill("24000,00");
  await page.getByLabel("Loyer annuel attendu").fill("18000,00");
  await page.getByRole("button", { name: "Créer l’opportunité" }).click();
  await page.waitForURL(/\/finance\/acquisitions\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await expect(page.getByTestId("opportunity-budget")).toHaveText(/240\s?000,00/);

  // --- The base scenario keeps its assumptions and shows what they produce ---
  await page.getByLabel("Libellé", { exact: true }).fill("Financement bancaire");
  await page.getByLabel("Prêteur envisagé").fill("Banque Démo");
  await page.getByLabel("Emprunt").fill("200000,00");
  await page.getByLabel("Apport").fill("40000,00");
  await page.getByLabel("Taux (%)").fill("3,6");
  await page.getByLabel("Durée (mois)").fill("240");
  await page.getByLabel("Charges annuelles").fill("3000,00");
  await page.getByRole("button", { name: "Ajouter le scénario" }).click();

  const gap = page.getByTestId("scenario-gap");
  await expect(gap).toBeVisible({ timeout: 15_000 });
  // 200 000 + 16 000 + 24 000 financed by 200 000 + 40 000: nothing is missing.
  await expect(gap).toHaveText(/0,00/);
  await expect(page.getByText("Base", { exact: true })).toBeVisible();

  await assertAccessible(page, "/finance/acquisitions/[id]");

  // --- The conversion creates the objects once, at decision level D ---------
  await page.getByLabel("Code de l’immeuble").fill(`BEL-${Date.now()}`);
  await page.getByLabel("Date de signature").fill("2026-09-01");
  await page.getByLabel("Prix d’acquisition").fill("200000,00");
  await page.getByLabel("Valeur du terrain").fill("60000,00");
  await page.getByRole("button", { name: "Convertir l’opportunité" }).click();

  const outcome = page.getByTestId("convert-outcome");
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  await expect(outcome).toContainText("convertie");
  await expect(page.getByTestId("conversion-result")).toBeVisible();

  const after = await conversionSnapshot(fixture.organizationId);
  expect(after.buildings).toBe(before.buildings + 1);
  expect(after.assets).toBe(before.assets + 1);
  expect(after.loans).toBe(before.loans + 1);
  expect(after.commands).toBe(before.commands + 1);
  expect(await countPreparedCommands(fixture.organizationId, "convert_acquisition")).toBe(1);

  // A second conversion writes nothing: the button is disabled and a reload
  // still shows the first conversion's objects.
  await expect(page.getByRole("button", { name: "Convertir l’opportunité" })).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("conversion-result")).toBeVisible({ timeout: 15_000 });
  const again = await conversionSnapshot(fixture.organizationId);
  expect(again).toEqual(after);

  // --- The opportunity is listed as converted -------------------------------
  await page.goto("/finance/acquisitions");
  await expect(page.getByRole("cell", { name: "Immeuble Bellevue" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Convertie").first()).toBeVisible();
  await assertAccessible(page, "/finance/acquisitions");
});
