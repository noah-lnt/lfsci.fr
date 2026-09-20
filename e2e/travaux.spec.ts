import { expect, type Page, test } from "@playwright/test";
import { assertAccessible } from "./helpers/axe";
import { closeFixtures, eventTypesOf, seedPatrimoine } from "./helpers/finance-fixtures";

const _SERIOUS = new Set(["serious", "critical"]);

test.use({ reducedMotion: "reduce" });

test.afterAll(async () => {
  await closeFixtures();
});

async function signUp(page: Page): Promise<string> {
  const slug = `trv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Travaux");
  await page.getByLabel("Adresse e-mail").fill(`${slug}@example.test`);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
  return slug;
}

async function pick(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the owner reports an intervention, closes it with its result, and reads two meters", async ({
  page,
}) => {
  test.slow();
  const slug = await signUp(page);
  const fixture = await seedPatrimoine(slug);

  // --- MAI-01 / WF-06: report, advance, close with the observed result ------
  await page.goto("/travaux/interventions/nouvelle");
  // Picking first proves the page is hydrated and the lookups have landed, so
  // React cannot reset a controlled input that was filled too early.
  await pick(page, "Urgence", "Élevée");
  await pick(page, "Lot", "A1 — Appartement A1");
  await page.getByLabel("Intitulé").fill("Fuite sous l’évier");
  await page.getByLabel("Description").fill("Le locataire signale une fuite au joint.");
  await expect(page.getByLabel("Intitulé")).toHaveValue("Fuite sous l’évier");
  await page.getByRole("button", { name: "Signaler", exact: true }).click();
  await page.waitForURL(/\/travaux\/interventions\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  const interventionId = page.url().split("/").at(-1) ?? "";
  expect(interventionId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByTestId("intervention-status")).toHaveText("Signalée");

  for (const step of ["Qualifiée", "Planifiée", "En cours"]) {
    await page.getByRole("button", { name: step, exact: true }).click();
    await expect(page.getByTestId("intervention-status")).toHaveText(step, { timeout: 15_000 });
  }

  // TRA-02: the hours are operational; their valuation stays a simulated cost.
  await page.getByLabel("Résultat observé").fill("Joint remplacé, plus de fuite constatée.");
  await page.getByLabel("Temps passé (heures)").fill("1,50");
  await page.getByLabel("Valorisation horaire (facultative)").fill("40,00");
  await page.getByLabel("Prochaine vérification").fill("2027-03-01");
  await page.getByRole("button", { name: "Clôturer l’intervention" }).click();

  await expect(page.getByTestId("intervention-status")).toHaveText("Terminée", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("intervention-notice")).toHaveText(
    "Une échéance de contrôle a été créée.",
  );
  await expect(page.getByText("60,00 €")).toBeVisible();

  const events = await eventTypesOf(fixture.organizationId, "intervention", interventionId);
  expect(events).toContain("intervention.reported");
  expect(events).toContain("intervention.done");

  await assertAccessible(page, "/travaux/interventions/[id]");

  // --- COM-01: a lower index opens an exception, never a negative reading ---
  await page.goto("/travaux/compteurs");
  await pick(page, "Immeuble", "Immeuble Demo");
  await pick(page, "Fluide", "Eau froide");
  await page.getByLabel("N° de série").fill("CPT-0001");
  await page.getByRole("button", { name: "Créer", exact: true }).click();

  await expect(page.getByRole("cell", { name: "CPT-0001" })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Index", { exact: true }).fill("100");
  await page.getByLabel("Date du relevé").fill("2026-09-01");
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();
  // The index shows twice: on the meter row and on the reading row.
  await expect(page.getByRole("cell", { name: "100.0000" }).first()).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Index", { exact: true }).fill("90");
  await page.getByLabel("Date du relevé").fill("2026-09-15");
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();

  const exception = page.getByTestId("reading-exception");
  await expect(exception).toBeVisible({ timeout: 15_000 });
  await expect(exception).toContainText("inférieur");
  await expect(page.getByTestId("meter-exceptions")).toHaveText("1", { timeout: 15_000 });

  await assertAccessible(page, "/travaux/compteurs");

  await page.goto("/travaux");
  await expect(page.getByRole("link", { name: "Fuite sous l’évier" })).toBeVisible({
    timeout: 15_000,
  });
  await assertAccessible(page, "/travaux");
});
