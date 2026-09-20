export { assertAccessible } from "../helpers/axe";

import type { Page } from "@playwright/test";

const _SERIOUS = new Set(["serious", "critical"]);

export function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Zero serious or critical axe violation, the bar set in the tech pack §9. */

/**
 * The `next dev` tools badge is a floating host element that covers the bottom
 * of a phone viewport and swallows clicks; it does not exist in a build.
 */
export async function muteDevOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none !important}";
      document.head.append(style);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide, { once: true });
  });
}

/** A fresh owner with its own organization, as the smoke spec does it. */
export async function signUp(page: Page): Promise<string> {
  const slug = unique("sci");
  await muteDevOverlay(page);
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Test");
  await page.getByLabel("Adresse e-mail").fill(`${slug}@example.test`);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 60_000 });
  return slug;
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

export type Chain = { entityUrl: string; buildingUrl: string; unitUrl: string; code: string };

/** SCI → immeuble → lot, created through the UI in the business's own order. */
export async function createChain(page: Page): Promise<Chain> {
  const code = unique("A").toUpperCase();

  await page.goto("/patrimoine");
  await page.getByRole("link", { name: "Ajouter une SCI" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("SCI des Lilas");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForURL(/\/patrimoine\/sci\/[0-9a-f-]+$/, { timeout: 60_000 });
  const entityUrl = page.url();

  await page.getByRole("link", { name: "Ajouter un immeuble" }).click();
  await page.waitForURL(/\/patrimoine\/immeubles\/nouveau/, { timeout: 60_000 });
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.getByLabel("Nom", { exact: true }).fill("Résidence des Lilas");
  await page.getByLabel("Adresse", { exact: true }).fill("1 rue des Lilas");
  await page.getByLabel("Ville", { exact: true }).fill("Pau");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForURL(/\/patrimoine\/immeubles\/[0-9a-f-]+$/, { timeout: 60_000 });
  const buildingUrl = page.url();

  await page.getByRole("link", { name: "Ajouter un lot" }).click();
  await page.waitForURL(/\/patrimoine\/lots\/nouveau/, { timeout: 60_000 });
  await page.getByLabel("Code", { exact: true }).fill("L1");
  await page.getByLabel("Désignation", { exact: true }).fill("T2 au premier");
  await choose(page, "Nature", "Logement");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForURL(/\/patrimoine\/lots\/[0-9a-f-]+$/, { timeout: 60_000 });

  return { entityUrl, buildingUrl, unitUrl: page.url(), code };
}

export { choose };
