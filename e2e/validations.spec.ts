import { expect, test } from "@playwright/test";
import {
  closeDb,
  insertPreparedCommand,
  readCommand,
  signUpOwner,
} from "./helpers/accueil-fixtures";
import { assertAccessible } from "./helpers/axe";

test.use({ reducedMotion: "reduce" });
test.afterAll(closeDb);

test("a level D command waits for the owner, then leaves for the outbox", async ({ page }) => {
  const owner = await signUpOwner(page);
  const command = await insertPreparedCommand(owner);

  await page.goto("/validations");

  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Réviser un loyer");
  await expect(card).toContainText("Niveau D");
  await expect(card).toContainText("814,83 €");
  await assertAccessible(page, "/validations");

  const before = await readCommand(command.commandId);
  expect(before.status).toBe("prepared");
  expect(before.outboxRows).toBe(0);

  await card.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByTestId("validations-empty")).toBeVisible();

  await expect.poll(async () => (await readCommand(command.commandId)).status).toBe("authorized");
  expect((await readCommand(command.commandId)).outboxRows).toBe(1);
});

test("a refusal demands a reason and cancels the command", async ({ page }) => {
  const owner = await signUpOwner(page);
  const command = await insertPreparedCommand(owner);

  await page.goto("/validations");
  const card = page.getByTestId("approval-card");
  const refuse = card.getByRole("button", { name: "Refuser" });
  await expect(refuse).toBeDisabled();

  await card.getByLabel("Motif du refus").fill("L’indice de référence n’est pas le bon.");
  await refuse.click();

  await expect.poll(async () => (await readCommand(command.commandId)).status).toBe("cancelled");
});
