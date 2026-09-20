import { expect, test } from "@playwright/test";
import { closeDb, insertDeadline, isoDaysFromToday, signUpOwner } from "./helpers/accueil-fixtures";
import { assertAccessible } from "./helpers/axe";

test.use({ reducedMotion: "reduce" });
test.afterAll(closeDb);

test("deadlines group by horizon and completing one records a fact", async ({ page }) => {
  const owner = await signUpOwner(page);

  await insertDeadline(owner, { title: "Assurance PNO expirée", dueOn: isoDaysFromToday(-5) });
  await insertDeadline(owner, { title: "Relevé de compteur", dueOn: isoDaysFromToday(4) });
  await insertDeadline(owner, { title: "Révision annuelle du loyer", dueOn: isoDaysFromToday(20) });

  await page.goto("/echeancier");

  await expect(page.getByRole("region", { name: "En retard" })).toContainText(
    "Assurance PNO expirée",
  );
  await expect(page.getByRole("region", { name: "7 jours" })).toContainText("Relevé de compteur");
  await expect(page.getByRole("region", { name: "30 jours" })).toContainText(
    "Révision annuelle du loyer",
  );
  await assertAccessible(page, "/echeancier");

  const overdue = page.getByTestId("deadline-row").filter({ hasText: "Assurance PNO expirée" });
  await overdue.getByRole("button", { name: "Accomplir" }).click();

  await expect(page.getByTestId("deadline-row").filter({ hasText: "Assurance PNO" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("deadline-row")).toHaveCount(2);
});

test("a report keeps the initial date and its reason", async ({ page }) => {
  const owner = await signUpOwner(page);
  await insertDeadline(owner, { title: "Contrôle chaudière", dueOn: isoDaysFromToday(2) });

  await page.goto("/echeancier");
  const row = page.getByTestId("deadline-row").filter({ hasText: "Contrôle chaudière" });
  await row.getByRole("button", { name: "Reporter" }).click();

  await page.getByLabel("Nouvelle date").fill(isoDaysFromToday(40));
  await page.getByLabel("Motif du report").fill("Le prestataire n’est pas disponible.");
  await page.getByRole("button", { name: "Confirmer" }).click();

  const moved = page.getByTestId("deadline-row").filter({ hasText: "Contrôle chaudière" });
  await expect(moved).toContainText("Date initiale");
  await expect(moved).toContainText("Le prestataire n’est pas disponible.");
});
