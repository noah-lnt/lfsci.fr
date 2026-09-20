import { expect, test } from "@playwright/test";
import { closeDb, signUpOwner } from "./helpers/accueil-fixtures";
import { assertAccessible } from "./helpers/axe";

test.use({ reducedMotion: "reduce" });
test.afterAll(closeDb);

test("a captured note is triaged and leaves the inbox once attached", async ({ page }) => {
  await signUpOwner(page);

  await page.goto("/inbox");
  await expect(page.getByTestId("inbox-empty")).toBeVisible();
  await assertAccessible(page, "/inbox");

  await page
    .getByLabel("Contenu")
    .fill("Le locataire signale une fuite sous l’évier de la cuisine.");
  await page.getByRole("button", { name: "Enregistrer dans l’inbox" }).click();

  const item = page.getByTestId("inbox-item").filter({ hasText: "fuite sous l’évier" });
  await expect(item).toBeVisible();
  await expect(page.getByTestId("inbox-empty")).toHaveCount(0);

  await item.click();
  await expect(page.getByTestId("inbox-detail")).toContainText("fuite sous l’évier");

  await page.getByLabel("Rattacher à la société de la SCI").click();
  await page.getByRole("option", { name: "SCI de démonstration" }).click();
  await page.getByRole("button", { name: "Rattacher", exact: true }).click();

  await expect(page.getByTestId("inbox-empty")).toBeVisible();
  await expect(page.getByTestId("inbox-item")).toHaveCount(0);
});
