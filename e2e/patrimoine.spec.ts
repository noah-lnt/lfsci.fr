import { expect, test } from "@playwright/test";
import { assertAccessible, choose, createChain, signUp } from "./fixtures/patrimoine";

// One dev server serves every project; ten concurrent sign-up flows starve it,
// and a route still compiling must not trip the default 5 s action timeout.
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });

test("the owner builds SCI → immeuble → lot and reads the lot's timeline", async ({ page }) => {
  await signUp(page);
  const chain = await createChain(page);

  // The tree shows the three levels with its occupancy badges.
  await page.goto("/patrimoine");
  await expect(page.getByRole("link", { name: "SCI des Lilas" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: `${chain.code} — Résidence des Lilas` }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "L1 — T2 au premier" })).toBeVisible();
  await expect(page.getByText("1 lot", { exact: true }).first()).toBeVisible();
  await assertAccessible(page, "/patrimoine");

  // A filter that matches nothing empties the view and shows its chip.
  await page.getByLabel("Rechercher une SCI, un immeuble, une ville").fill("introuvable");
  await expect(page.getByText("Aucun bien ne correspond aux filtres.")).toBeVisible();
  await page.getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(page.getByRole("link", { name: "L1 — T2 au premier" })).toBeVisible();

  // Edit the lot.
  await page.goto(chain.unitUrl);
  await page.getByRole("link", { name: "Modifier" }).click();
  await page.waitForURL(/\/modifier$/, { timeout: 60_000 });
  await page.getByLabel("Désignation", { exact: true }).fill("T2 rénové");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForURL(/\/patrimoine\/lots\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "T2 rénové", level: 1 })).toBeVisible();

  // Dated usage change (PAT-01).
  await choose(page, "Usage en cours", "Location meublée");
  await page.getByLabel("Début", { exact: true }).fill("2026-01-01");
  await page.getByRole("button", { name: "Changer l’usage" }).click();
  // The toast fires in onSuccess, so it proves the transaction committed; the
  // select showing the new label proves nothing.
  await expect(page.getByText("Usage enregistré.")).toBeVisible();

  // unit_created, unit_updated and unit_usage_changed all reach the lot.
  await page.getByRole("tab", { name: "Timeline" }).click();
  const items = page.getByTestId("timeline-item");
  await expect(items).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByText("Lot créé", { exact: true })).toBeVisible();
  await expect(page.getByText("Lot modifié", { exact: true })).toBeVisible();
  await expect(page.getByText("Usage du lot modifié", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Synthèse" }).click();
  await assertAccessible(page, "fiche lot");
});

test("a second usage period starting inside the first is refused", async ({ page }) => {
  await signUp(page);
  const chain = await createChain(page);

  await page.goto(chain.unitUrl);
  await choose(page, "Usage en cours", "Location nue");
  await page.getByLabel("Début", { exact: true }).fill("2026-03-01");
  await page.getByRole("button", { name: "Changer l’usage" }).click();
  await expect(page.getByText("Usage enregistré.")).toBeVisible();

  // Same start date: the daterange exclusion constraint refuses the overlap.
  await page.reload();
  await choose(page, "Usage en cours", "Location touristique");
  await page.getByLabel("Début", { exact: true }).fill("2026-03-01");
  await page.getByRole("button", { name: "Changer l’usage" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "chevauche" });
  await expect(alert).toHaveCount(1);
  await expect(page.getByTestId("error-request-id")).not.toBeEmpty();
});

test("an unknown lot id renders the 404 page, never a 403", async ({ page }) => {
  await signUp(page);
  const response = await page.goto("/patrimoine/lots/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
  expect(response?.status()).toBe(404);
});
