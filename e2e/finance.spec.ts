import { expect, type Page, test } from "@playwright/test";
import { assertAccessible } from "./helpers/axe";
import {
  allocationAmountsOf,
  closeFixtures,
  countPreparedCommands,
  loanInstallmentCount,
  seedPatrimoine,
} from "./helpers/finance-fixtures";

const _SERIOUS = new Set(["serious", "critical"]);

test.use({ reducedMotion: "reduce" });

test.afterAll(async () => {
  await closeFixtures();
});

async function signUp(page: Page): Promise<string> {
  const slug = `fin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Finance");
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

test("the owner captures, allocates and validates an expense, then a loan and a CCA movement", async ({
  page,
}) => {
  test.slow();
  const slug = await signUp(page);
  const fixture = await seedPatrimoine(slug);

  // --- DEP-01/DEP-02/CHA-01: one capture, two lines, one allocation each -----
  await page.goto("/finance/depenses/nouvelle");
  await pick(page, "SCI", "SCI de démonstration");
  await page.getByLabel("Nom du fournisseur").fill("Peinture Démo");
  await page.getByLabel("Référence fournisseur").fill("FA-2026-001");

  const line1 = page.getByRole("group", { name: "Libellé 1" });
  await line1.getByLabel("Libellé", { exact: true }).fill("Peinture lot A1");
  await line1.getByLabel("Montant TTC", { exact: true }).fill("600,00");
  await line1.getByLabel("Lot", { exact: true }).click();
  await page.getByRole("option", { name: "A1 — Appartement A1", exact: true }).click();

  await page.getByRole("button", { name: "Ajouter une ligne" }).click();
  const line2 = page.getByRole("group", { name: "Libellé 2" });
  await line2.getByLabel("Libellé", { exact: true }).fill("Peinture lot A2");
  await line2.getByLabel("Montant TTC", { exact: true }).fill("400,00");
  await line2.getByLabel("Lot", { exact: true }).click();
  await page.getByRole("option", { name: "A2 — Appartement A2", exact: true }).click();

  // The live split is the domain's, so the total is exact before saving.
  await expect(page.getByTestId("expense-total")).toHaveText(/1\s?000,00/);
  await page.getByRole("button", { name: "Enregistrer la dépense" }).click();
  await page.waitForURL(/\/finance\/depenses\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await expect(page.getByText("Peinture lot A1")).toBeVisible();
  await expect(page.getByText("Peinture lot A2")).toBeVisible();
  // Nothing is left unallocated: the deferred balance trigger accepted the write.
  await expect(page.getByText("Résidu non affecté").first()).toBeVisible();
  expect(await allocationAmountsOf(fixture.organizationId)).toEqual([
    { amount: "600.00", unitId: fixture.unitIds[0] },
    { amount: "400.00", unitId: fixture.unitIds[1] },
  ]);

  // --- DEP-02 / ARC-02: validation prepares the command, nothing is sent -----
  await page.getByRole("button", { name: "Valider", exact: true }).click();
  const outcome = page.getByTestId("validation-outcome");
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  await expect(outcome).toContainText("niveau D");
  expect(await countPreparedCommands(fixture.organizationId, "post_supplier_bill")).toBe(1);

  await assertAccessible(page, "/finance/depenses/[id]");

  // --- CRE-01: the schedule is built and its capital sums to the principal ---
  await page.goto("/finance/credits/nouveau");
  await pick(page, "SCI", "SCI de démonstration");
  await page.getByLabel("Prêteur").fill("Banque Démo");
  await page.getByLabel("Référence", { exact: true }).fill(`PRET-${Date.now()}`);
  await page.getByLabel("Capital emprunté").fill("100000,00");
  await page.getByLabel("Durée (mois)").fill("240");
  await page.getByLabel("Taux nominal (%)").fill("3,6");
  await page.getByLabel("Première échéance").fill("2026-10-05");
  await page.getByRole("button", { name: "Créer le crédit et l’échéancier" }).click();
  await page.waitForURL(/\/finance\/credits\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await expect(page.getByTestId("schedule-sum")).toHaveText(
    "La somme des capitaux amortis égale le capital emprunté.",
  );
  await expect(page.getByTestId("total-principal")).toHaveText(/100\s?000,00/);
  expect(await loanInstallmentCount(fixture.organizationId)).toBe(240);

  // --- CCA-02: the movement waits for a validation at level D ---------------
  await page.goto("/finance/cca");
  await pick(page, "Compte courant", "Associé Démo");
  await pick(page, "Nature", "Apport");
  await page.getByLabel("Montant", { exact: true }).fill("500,00");
  await page.getByLabel("Justification").fill("Apport en compte courant pour les travaux");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const ccaOutcome = page.getByTestId("cca-outcome");
  await expect(ccaOutcome).toBeVisible({ timeout: 15_000 });
  await expect(ccaOutcome).toContainText("niveau D");
  expect(await countPreparedCommands(fixture.organizationId, "record_cca_movement")).toBe(1);

  // --- FIN-01: the dashboard reads every figure with its source -------------
  await page.goto("/finance");
  await expect(page.getByTestId("kpi-banks")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("kpi-debt")).toBeVisible();
  await expect(page.getByTestId("kpi-cca")).toBeVisible();
  await expect(page.getByTestId("forecast-closing")).toBeVisible({ timeout: 15_000 });

  // TRE-01: the data table is the accessible view of the same forecast.
  await page.getByRole("button", { name: "Afficher le tableau de données" }).click();
  await expect(page.getByRole("button", { name: "Masquer le tableau de données" })).toBeVisible();

  await assertAccessible(page, "/finance");
});

test("the owner keeps the asset register and the bank accounts", async ({ page }) => {
  test.slow();
  const slug = await signUp(page);
  await seedPatrimoine(slug);

  // --- IMM-01/IMM-02: gross value, land, components, VNC ---------------------
  await page.goto("/finance/actifs/nouvelle");
  await pick(page, "SCI", "SCI de démonstration");
  await pick(page, "Immeuble", "Immeuble Demo");
  await page.getByLabel("Libellé", { exact: true }).fill("Immeuble Demo");
  await page.getByLabel("Valeur brute", { exact: true }).fill("300000,00");
  await page.getByLabel("Valeur du terrain", { exact: true }).fill("60000,00");
  await page.getByLabel("Mise en service").fill("2020-01-01");
  await page.getByRole("button", { name: "Créer l’immobilisation" }).click();
  await page.waitForURL(/\/finance\/actifs\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  // No duration was entered: the default applies and the screen says it.
  await expect(page.getByText("une durée par défaut a été appliquée")).toBeVisible();
  const nbv = page.getByTestId("asset-detail-nbv");
  await expect(nbv).toBeVisible();

  // A component carries its own duration; the register sums components.
  const componentForm = page.locator("form", {
    has: page.getByRole("button", { name: "Ajouter le composant" }),
  });
  await componentForm.getByLabel("Composant", { exact: true }).fill("Toiture");
  await componentForm.getByLabel("Valeur brute", { exact: true }).fill("40000,00");
  await componentForm.getByLabel("Durée (années)", { exact: true }).fill("20");
  await componentForm.getByRole("button", { name: "Ajouter le composant" }).click();
  await expect(page.getByRole("cell", { name: "Toiture" })).toBeVisible({ timeout: 15_000 });

  await assertAccessible(page, "/finance/actifs/[id]");

  await page.goto("/finance/actifs");
  await expect(page.getByTestId("asset-nbv").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("assets-default")).toBeVisible();
  await assertAccessible(page, "/finance/actifs");

  // --- BAN-01: a balance never appears without saying where it comes from ----
  await page.goto("/finance/banques");
  const total = page.getByTestId("bank-total");
  await expect(total).toBeVisible({ timeout: 15_000 });
  await expect(total).toHaveText(/10\s?000,00/);
  // No movement has been mirrored: the figure is the opening balance, and says so.
  await expect(page.getByText("solde d’ouverture, aucun mouvement connu").first()).toBeVisible();

  await page.getByRole("button", { name: "Nouveau compte" }).click();
  await pick(page, "SCI", "SCI de démonstration");
  await page.getByLabel("Libellé", { exact: true }).fill("Compte dépôts");
  await page.getByLabel("Solde d’ouverture", { exact: true }).fill("2000,00");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByRole("cell", { name: "Compte dépôts" })).toBeVisible({ timeout: 15_000 });
  await expect(total).toHaveText(/12\s?000,00/);

  // F09: an internal transfer is cash moving between our own accounts.
  await pick(page, "Compte débité", "Compte courant SCI");
  await pick(page, "Compte crédité", "Compte dépôts");
  await page.getByLabel("Montant", { exact: true }).fill("500,00");
  await page.getByRole("button", { name: "Enregistrer le virement" }).click();
  await expect(page.getByRole("cell", { name: "En transit" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Marquer reçu" }).first().click();
  await expect(page.getByRole("cell", { name: "Reçu" })).toBeVisible({ timeout: 15_000 });

  await assertAccessible(page, "/finance/banques");
});
