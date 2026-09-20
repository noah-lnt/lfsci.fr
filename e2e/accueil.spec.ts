import { expect, test } from "@playwright/test";
import { closeDb, insertDeadline, isoDaysFromToday, signUpOwner } from "./helpers/accueil-fixtures";
import { assertAccessible } from "./helpers/axe";

test.use({ reducedMotion: "reduce" });
test.afterAll(closeDb);

test("the home names what needs the owner and never claims all is well blindly", async ({
  page,
}) => {
  const owner = await signUpOwner(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ce qui nécessite mon intervention",
  );

  // No nightly control has run on a fresh organization.
  const banner = page.getByTestId("situation-banner");
  await expect(banner).toHaveAttribute("data-controls", "sources_unavailable");
  await expect(page.getByText("Rien ne nécessite votre intervention.")).toHaveCount(0);
  await expect(page.getByTestId("accueil-empty")).toContainText(
    "les contrôles ne sont pas complets",
  );

  await assertAccessible(page, "/");

  await insertDeadline(owner, {
    title: "Révision de loyer BAIL-E2E",
    dueOn: isoDaysFromToday(3),
    priority: "high",
  });

  await page.reload();
  const card = page.getByTestId("action-card").filter({ hasText: "Révision de loyer BAIL-E2E" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "Ouvrir l’échéance" })).toHaveAttribute(
    "href",
    /\/echeancier#/,
  );
  await expect(page.getByTestId("accueil-empty")).toHaveCount(0);

  await card.getByRole("link", { name: "Ouvrir l’échéance" }).click();
  await expect(page).toHaveURL(/\/echeancier/);
});

test("the situation strip renders absent figures as a dash, never as zero", async ({ page }) => {
  await signUpOwner(page);
  const strip = page.getByRole("region", { name: "Situation" });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("—");
});

test("the assistant says it is unavailable instead of failing when no model is configured", async ({
  page,
}) => {
  await signUpOwner(page);

  await page.getByRole("banner").getByRole("button", { name: "Assistant" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toContainText("Posez une question");

  await panel.getByLabel("Assistant").fill("Que dois-je faire aujourd’hui ?");
  await panel.getByRole("button", { name: "Envoyer" }).click();

  await expect(panel.getByRole("alert")).toContainText("L’assistant n’est pas configuré");
});
