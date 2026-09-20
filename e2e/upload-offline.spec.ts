import { expect, test } from "@playwright/test";
import { createChain, signUp } from "./fixtures/patrimoine";

// One dev server serves every project; ten concurrent sign-up flows starve it,
// and a route still compiling must not trip the default 5 s action timeout.
test.describe.configure({ mode: "serial", timeout: 180_000 });
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });

const TICKET = "e2e/fixtures/ticket.png";

test("UX-03: a capture taken offline outlives the tab and is sent once back online", async ({
  page,
  context,
  isMobile,
}) => {
  // WebKit refuses to read a harness-supplied file while the context is offline
  // (NotReadableError), so on the phone the outage is played at the network
  // layer: every API call is cut and the browser is told it is offline.
  const goOffline = async (): Promise<void> => {
    if (!isMobile) {
      await context.setOffline(true);
      return;
    }
    await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  };
  const goOnline = async (): Promise<void> => {
    if (!isMobile) {
      await context.setOffline(false);
      return;
    }
    await page.unroute("**/api/**");
  };
  await signUp(page);
  const chain = await createChain(page);

  await page.goto(chain.unitUrl);
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByText("Aucun document.", { exact: false })).toBeVisible();

  await goOffline();
  await page.locator('input[type="file"]').setInputFiles(TICKET);

  const queue = page.getByTestId("upload-queue");
  await expect(queue).toContainText("ticket.png");
  await expect(page.getByText("Hors ligne", { exact: false })).toBeVisible();
  await expect(queue).not.toContainText("synchronisé");

  // The tab dies with no network: the document itself cannot be fetched again,
  // which is exactly the cellar case — only IndexedDB still holds the capture.
  await page.reload().catch(() => undefined);

  await goOnline();
  await page.goto(chain.unitUrl);
  await page.getByRole("tab", { name: "Documents" }).click();

  await expect(page.getByTestId("upload-queue")).toContainText("synchronisé", { timeout: 60_000 });
  const row = page.getByTestId("document-row").filter({ hasText: "ticket.png" });
  await expect(row).toHaveCount(1, { timeout: 60_000 });

  // A completed upload is recorded before its entry is dropped, so a further
  // reload must not produce a second document from the same bytes.
  await page.goto(chain.unitUrl);
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId("upload-queue")).toHaveCount(0);
});
