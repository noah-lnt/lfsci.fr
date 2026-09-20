import { expect, test } from "@playwright/test";
import { assertAccessible } from "./helpers/axe";

const _SERIOUS = new Set(["serious", "critical"]);

// The page-fade-in animation starts at opacity 0; axe must not sample mid-fade.
test.use({ reducedMotion: "reduce" });

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test("sign-in page is reachable and accessible", async ({ page }) => {
  await page.goto("/connexion");
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await assertAccessible(page, "/connexion");
});

test("the first owner creates the organization and lands on Accueil", async ({
  page,
  isMobile,
}) => {
  const slug = unique("sci");

  await page.goto("/connexion");
  await page.getByRole("link", { name: /Première installation/ }).click();
  await page.waitForURL(/\/inscription$/, { timeout: 30_000 });

  await page.getByLabel("Nom complet").fill("Propriétaire Test");
  await page.getByLabel("Adresse e-mail").fill(`${slug}@example.test`);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();

  await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Ce qui nécessite mon intervention", level: 1 }),
  ).toBeVisible();
  await assertAccessible(page, "Accueil");

  if (isMobile) {
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("link", { name: "Patrimoine" })).toBeVisible();
    await drawer.getByRole("link", { name: "Locations" }).click();
    await expect(page).toHaveURL(/\/locations$/);
  } else {
    await expect(page.getByRole("link", { name: "Patrimoine" })).toBeVisible();
    await page.getByRole("link", { name: "Ops" }).click();
    await expect(page).toHaveURL(/\/admin\/ops$/);
    await expect(page.getByRole("heading", { name: "Tracer une référence" })).toBeVisible();
  }
});

test("an anonymous visitor is sent to the sign-in page", async ({ page }) => {
  await page.goto("/patrimoine");
  await expect(page).toHaveURL(/\/connexion$/);
});
