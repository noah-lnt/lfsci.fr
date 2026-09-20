import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// Imported by path, not through "@lfsci/db": the package index re-exports the
// migrator, whose `import.meta` the Playwright CommonJS transform cannot load.
import { createDb, type DbHandle } from "../packages/db/src/client";
import * as tables from "../packages/db/src/generated/schema";
import { withTenant } from "../packages/db/src/tenant";
import { assertAccessible } from "./helpers/axe";
import { closeFixtures, seedPatrimoine } from "./helpers/finance-fixtures";

const INSURER = "Assurances Générales du Sud";
const POLICY_NUMBER = "PNO-2026-0041";

test.use({ reducedMotion: "reduce" });

let handle: DbHandle | undefined;

function db(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to seed the e2e fixtures");
  if (!handle) handle = createDb({ url, max: 2, applicationName: "lfsci-e2e-assurances" });
  return handle;
}

test.afterAll(async () => {
  const open = handle;
  handle = undefined;
  await open?.close();
  await closeFixtures();
});

async function signUp(page: Page): Promise<string> {
  const slug = `ass-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Assurances");
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

/**
 * Stands in for the capture pipeline: a document already stored, an inbox item
 * and the extraction the model would have written (ASS-01 reads those rows).
 */
async function seedAttestation(organizationId: string): Promise<void> {
  await withTenant(db(), { organizationId }, async (tx) => {
    const [document] = await tx
      .insert(tables.document)
      .values({
        organizationId,
        title: "Attestation PNO 2027",
        nature: "attestation",
        status: "active",
      })
      .returning({ id: tables.document.id });
    if (!document) throw new Error("document insert returned no row");

    const [activity] = await tx
      .insert(tables.activity)
      .values({
        organizationId,
        channel: "email",
        direction: "inbound",
        subject: "Votre attestation d’assurance",
        occurredAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      })
      .returning({ id: tables.activity.id });
    if (!activity) throw new Error("activity insert returned no row");

    const [item] = await tx
      .insert(tables.inboxItem)
      .values({
        organizationId,
        activityId: activity.id,
        documentId: document.id,
        source: "email_forward",
        status: "analyzed",
      })
      .returning({ id: tables.inboxItem.id });
    if (!item) throw new Error("inbox_item insert returned no row");

    const fields: [string, string][] = [
      ["kind", "insurance_attestation"],
      ["insurer", INSURER.toUpperCase()],
      ["policyNumber", "pno 2026 0041"],
      ["insuredName", "SCI de démonstration"],
      ["address", "1 rue de la Démonstration, 64000 Pau"],
      ["validFrom", "2027-01-01"],
      ["validTo", "2028-06-30"],
      ["coverage.0", "Dégât des eaux"],
    ];
    await tx.insert(tables.aiExtraction).values(
      fields.map(([fieldPath, proposedValue]) => ({
        organizationId,
        inboxItemId: item.id,
        fieldPath,
        proposedValue,
        provider: "ollama",
        modelName: "qwen3:32b",
        decision: "pending" as const,
        autonomyLevel: "A",
      })),
    );
  });
}

async function certificateDocumentOf(organizationId: string): Promise<string | null> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const rows = await tx
      .select({ id: tables.insurancePolicy.lastCertificateDocumentId })
      .from(tables.insurancePolicy)
      .where(eq(tables.insurancePolicy.policyNumber, POLICY_NUMBER));
    return rows[0]?.id ?? null;
  });
}

test("the owner records a policy, sees the missing attestation as an exception, and closes it from the inbox", async ({
  page,
}) => {
  test.slow();
  const slug = await signUp(page);
  const fixture = await seedPatrimoine(slug);

  // --- ASS-01: the policy, its cover period and the renewal deadline --------
  await page.goto("/patrimoine/assurances");
  await expect(page.getByTestId("assurances-no-exception")).toBeVisible({ timeout: 20_000 });

  await pick(page, "Type de police", "PNO");
  await pick(page, "SCI titulaire", "SCI de démonstration");
  await page.getByLabel("Assureur", { exact: true }).fill(INSURER);
  await page.getByLabel("N° de contrat", { exact: true }).fill(POLICY_NUMBER);
  await page.getByLabel("Début de garantie").fill("2026-01-01");
  await page.getByLabel("Fin de garantie").fill("2027-06-30");
  await page.getByLabel("Prime", { exact: true }).fill("480,00");
  await page.getByLabel("Franchise", { exact: true }).fill("150,00");
  await page
    .getByLabel("Garanties renseignées")
    .fill("Dégât des eaux, incendie, responsabilité civile propriétaire.");
  await expect(page.getByLabel("N° de contrat", { exact: true })).toHaveValue(POLICY_NUMBER);
  await page.getByRole("button", { name: "Créer", exact: true }).click();

  await page.waitForURL(/\/patrimoine\/assurances\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const policyUrl = page.url();
  await expect(page.getByTestId("policy-certificate")).toHaveText("Manquante");
  await expect(page.getByTestId("policy-deadlines")).toContainText("Attestation d’assurance");
  await expect(page.getByTestId("policy-deadlines")).toContainText("31/05/2027");

  // The covered property is what makes the policy actionable from a unit.
  await pick(page, "Nature du bien", "Lot");
  await pick(page, "Bien", "A1 — Appartement A1");
  await page.getByRole("button", { name: "Ajouter un bien couvert" }).click();
  await expect(page.getByTestId("policy-scopes")).toContainText("A1 — Appartement A1", {
    timeout: 15_000,
  });
  await assertAccessible(page, "/patrimoine/assurances/[id]");

  await page.goto("/patrimoine/assurances");
  await expect(page.getByTestId("assurances-exceptions")).toContainText(POLICY_NUMBER, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("assurances-exceptions")).toContainText("Manquante");
  await assertAccessible(page, "/patrimoine/assurances");

  // --- ASS-01: the attestation arrives and is attached in one action --------
  await seedAttestation(fixture.organizationId);
  await page.goto("/patrimoine/assurances/attestations");
  const candidate = page.getByTestId("attestation-candidate");
  await expect(candidate).toBeVisible({ timeout: 20_000 });
  await expect(candidate.getByTestId("attestation-matched")).toContainText([
    "N° de contrat",
    "Assureur",
    "Assuré",
    "Période",
  ]);
  await expect(candidate).toContainText("pno 2026 0041");

  // The four controls gate the attachment; nothing is attached without them.
  const attach = page.getByRole("button", { name: "Rattacher à cette police" });
  await expect(attach).toBeDisabled();
  for (const check of [
    "Identité de l’assuré vérifiée",
    "Bien couvert vérifié",
    "Couverture vérifiée",
    "Dates de validité vérifiées",
  ]) {
    await page.getByLabel(check, { exact: true }).click();
  }
  await expect(attach).toBeEnabled();
  await attach.click();

  await expect(page.getByTestId("attestation-notice")).toContainText("l’alerte est close", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("attestation-notice")).toContainText("2028-05-31");
  await assertAccessible(page, "/patrimoine/assurances/attestations");

  expect(await certificateDocumentOf(fixture.organizationId)).not.toBeNull();

  await page.goto(policyUrl);
  await expect(page.getByTestId("policy-certificate")).toHaveText("À jour", { timeout: 20_000 });

  await page.goto("/patrimoine/assurances");
  await expect(page.getByTestId("assurances-no-exception")).toBeVisible({ timeout: 20_000 });
});
