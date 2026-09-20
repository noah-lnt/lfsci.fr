import { expect, test } from "@playwright/test";
import { assertAccessible, createChain, signUp } from "./fixtures/patrimoine";

// One dev server serves every project; ten concurrent sign-up flows starve it,
// and a route still compiling must not trip the default 5 s action timeout.
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });

const TICKET = "e2e/fixtures/ticket.png";

test("a photo captured from the lot is stored, listed and downloadable", async ({ page }) => {
  await signUp(page);
  const chain = await createChain(page);

  await page.goto(chain.unitUrl);
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByText("Aucun document.", { exact: false })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(TICKET);

  // UX-03 wording: the queue says where the file is, never an ambiguous "sauvegardé".
  const queue = page.getByTestId("upload-queue");
  await expect(queue).toContainText("ticket.png");
  await expect(queue).toContainText("synchronisé", { timeout: 60_000 });

  const row = page.getByTestId("document-row").filter({ hasText: "ticket.png" });
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await expect(row).toContainText("À qualifier");

  // WebKit does not surface a download event for an attachment response, so the
  // presigned request is intercepted and fetched directly.
  const [request] = await Promise.all([
    page.waitForRequest((candidate) => candidate.url().includes("/api/storage/local/")),
    row.getByRole("button", { name: "Télécharger" }).click(),
  ]);
  const fetched = await page.request.get(request.url());
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()["content-disposition"] ?? "").toContain('filename="ticket.png"');
  expect((await fetched.body()).length).toBe(70);

  // Mobile WebKit opens the file inline instead of downloading; come back before the scan.
  if (!page.url().includes("/patrimoine/lots/")) {
    await page.goto(chain.unitUrl);
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(row).toHaveCount(1, { timeout: 20_000 });
  }
  await assertAccessible(page, "onglet Documents du lot");
});

test("the library lists the captured document and its filters clear", async ({ page }) => {
  await signUp(page);
  const chain = await createChain(page);

  await page.goto(chain.unitUrl);
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.locator('input[type="file"]').setInputFiles(TICKET);
  await expect(page.getByTestId("upload-queue")).toContainText("synchronisé", { timeout: 60_000 });

  await page.goto("/documents");
  await expect(page.getByTestId("document-row").filter({ hasText: "ticket.png" })).toHaveCount(1, {
    timeout: 60_000,
  });

  await page.getByLabel("Rechercher un document").fill("introuvable");
  await expect(page.getByText("Aucun document.", { exact: false })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(page.getByTestId("document-row").filter({ hasText: "ticket.png" })).toHaveCount(1, {
    timeout: 60_000,
  });
});
