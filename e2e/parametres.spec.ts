import { expect, type Page, test } from "@playwright/test";
import { signUp } from "./fixtures/patrimoine";
import { assertAccessible } from "./helpers/axe";

// One dev server serves every project; a route still compiling must not trip the
// default action timeout.
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });

/** The same password `signUp` gives the fresh owner. */
const PASSWORD = "motdepasse-tres-long-1";

type Focused = { id: string; name: string; tag: string };

function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return {
      id: element?.id ?? "",
      name: element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? "",
      tag: element?.tagName ?? "",
    };
  });
}

/** Walks the tab order from the top of the document, as a keyboard user would. */
async function tabUntil(page: Page, hit: (element: Focused) => boolean): Promise<Focused | null> {
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press("Tab");
    const element = await focused(page);
    if (hit(element)) return element;
  }
  return null;
}

test("the security screen states whether the second factor is on", async ({ page }) => {
  await signUp(page);
  await page.goto("/parametres/securite");

  await expect(page.getByRole("heading", { name: "Sécurité", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Double authentification inactive")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Activer la double authentification" }),
  ).toBeVisible();
  await expect(page.getByLabel("Mot de passe")).toBeVisible();
  await expect(page.getByRole("button", { name: "Générer la clé" })).toBeVisible();
  await expect(page.getByText("Aucun code de secours généré.")).toBeVisible();

  await assertAccessible(page, "écran Paramètres → Sécurité");
});

test("the enrolment is reachable and usable with the keyboard alone", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile === true, "iOS Safari has no sequential tab order to walk.");
  await signUp(page);
  await page.goto("/parametres/securite");
  await expect(page.getByRole("button", { name: "Générer la clé" })).toBeVisible();

  const field = await tabUntil(page, (element) => element.id === "enable-password");
  expect(field, "le champ mot de passe est atteignable au clavier").not.toBeNull();

  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Tab");
  expect((await focused(page)).name).toContain("Générer la clé");

  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Confirmer avec un code" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("img", { name: "Code QR de la clé TOTP" })).toBeVisible();
  await expect(page.getByLabel("Code à six chiffres")).toBeVisible();

  await assertAccessible(page, "Paramètres → Sécurité, enrôlement en cours");
});
