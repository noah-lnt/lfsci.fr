import { expect, test } from "@playwright/test";
import { closeDb, signUpOwner } from "./helpers/accueil-fixtures";
import { assertAccessible } from "./helpers/axe";

// One dev server serves every project; a route still compiling must not trip the
// default 5 s action timeout.
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });
test.afterAll(closeDb);

test("the search screen states its coverage before answering anything", async ({ page }) => {
  await signUpOwner(page);

  await page.goto("/recherche");
  await expect(page.getByRole("heading", { name: "Recherche", level: 1 })).toBeVisible();

  // MEM-02: the coverage is shown before any query, not hidden behind an empty answer.
  const coverage = page.getByTestId("recherche-coverage");
  await expect(coverage).toBeVisible({ timeout: 60_000 });
  await expect(coverage).toContainText("Couverture de l’index");
  await expect(page.getByTestId("recherche-coverage-row")).toHaveCount(4);
  await expect(coverage).toContainText("Document");
  await expect(coverage).toContainText("Activité");
  await expect(coverage).toContainText("Événement");
  await expect(coverage).toContainText("Intervention");

  await expect(page.getByText("Saisissez une recherche", { exact: false })).toBeVisible();
  await assertAccessible(page, "/recherche");
});

test("an unindexed corpus answers 'rien dans l’index', never 'rien n’existe'", async ({ page }) => {
  await signUpOwner(page);

  await page.goto("/inbox");
  await page
    .getByLabel("Contenu")
    .fill("Le locataire signale une fuite sous l’évier de la cuisine.");
  await page.getByRole("button", { name: "Enregistrer dans l’inbox" }).click();
  await expect(page.getByTestId("inbox-item")).toHaveCount(1, { timeout: 60_000 });

  await page.goto("/recherche");
  const coverage = page.getByTestId("recherche-coverage");
  await expect(coverage).toBeVisible({ timeout: 60_000 });
  // The note is an activity the indexing job has not reached yet: the screen says so.
  await expect(coverage).toContainText("Une partie du corpus n’est pas encore indexée");

  await page.getByLabel("Rechercher dans le corpus").fill("fuite");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();

  const empty = page.getByTestId("recherche-empty");
  await expect(empty).toBeVisible({ timeout: 60_000 });
  await expect(empty).toContainText("Aucun résultat dans ce qui est indexé.");
  await expect(empty).toContainText("Cela ne veut pas dire que rien n’existe");
  await assertAccessible(page, "/recherche après une recherche");
});

test("the source and period filters apply and clear", async ({ page }) => {
  await signUpOwner(page);

  await page.goto("/recherche");
  await page.getByLabel("Rechercher dans le corpus").fill("chaudière");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByTestId("recherche-empty")).toBeVisible({ timeout: 60_000 });

  const clear = page.getByRole("button", { name: "Effacer les filtres" });
  await expect(clear).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Document", exact: true }).click();
  await page.getByLabel("À partir du").fill("2026-01-01");
  await expect(clear).toBeVisible();

  await clear.click();
  await expect(clear).toHaveCount(0);
  await expect(page.getByLabel("À partir du")).toHaveValue("");
});

test("the keyboard alone reaches the query box and its filters", async ({ page, isMobile }) => {
  test.skip(isMobile, "there is no physical keyboard on the phone viewport");
  await signUpOwner(page);

  await page.goto("/recherche");
  const query = page.getByLabel("Rechercher dans le corpus");
  await query.focus();
  await query.fill("quittance");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("recherche-empty")).toBeVisible({ timeout: 60_000 });

  const kind = page.getByRole("checkbox", { name: "Activité", exact: true });
  await kind.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Effacer les filtres" })).toBeVisible();
});

test("the navigation carries the search entry", async ({ page, isMobile }) => {
  await signUpOwner(page);
  await page.goto("/");

  if (isMobile) {
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Recherche" }).click();
  } else {
    await page.getByRole("link", { name: "Recherche" }).click();
  }
  await expect(page).toHaveURL(/\/recherche$/);
  await expect(page.getByRole("heading", { name: "Recherche", level: 1 })).toBeVisible();
});

test("the inbox carries the rule proposals with their two actions", async ({ page }) => {
  await signUpOwner(page);

  await page.goto("/inbox");
  const proposals = page.getByTestId("inbox-proposals");
  await expect(proposals).toBeVisible({ timeout: 60_000 });
  await expect(proposals).toContainText("Règles proposées");

  // IA-06: with nothing repeated yet, the section says why rather than disappearing.
  await expect(page.getByTestId("inbox-proposals-empty")).toBeVisible({ timeout: 60_000 });
  await expect(proposals).toContainText("Rien n’est appliqué sans votre validation.");
  await expect(page.getByTestId("inbox-proposal")).toHaveCount(0);

  await assertAccessible(page, "/inbox avec les règles proposées");
});
