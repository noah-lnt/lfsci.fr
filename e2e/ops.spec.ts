import { expect, test } from "@playwright/test";
import { closeDb, signUpOwner } from "./helpers/accueil-fixtures";

test.use({ reducedMotion: "reduce" });
test.afterAll(closeDb);

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the correlation id the browser sent is searchable in the ops screen", async ({ page }) => {
  await signUpOwner(page);

  await page.goto("/admin/ops");
  await expect(page.getByRole("heading", { name: "Tracer une référence" })).toBeVisible();

  await page.getByRole("button", { name: "ping" }).click();
  await expect(page.getByTestId("ops-returned")).toHaveText(UUID_V7);

  const returned = await page.getByTestId("ops-returned").innerText();
  await expect(page.getByLabel("Référence de corrélation")).toHaveValue(returned);

  await page.getByRole("button", { name: "Rechercher" }).click();

  // The echo left no command behind, so the tables must render empty, not error.
  await expect(page.getByRole("heading", { name: "Échanges d’intégration" })).toBeVisible();
  await expect(page.getByTestId("error-request-id")).toHaveCount(0);
});
