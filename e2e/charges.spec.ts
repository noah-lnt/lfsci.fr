import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// Deep source imports: the @lfsci/db barrel re-exports the migrator, whose
// `import.meta` cannot be loaded by Playwright's CommonJS transpilation.
import { createDb, type DbHandle } from "../packages/db/src/client";
import * as tables from "../packages/db/src/generated/schema";
import { withTenant } from "../packages/db/src/tenant";
import { assertAccessible } from "./helpers/axe";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const YEAR = 2026;
const PERIOD_START = `${YEAR}-01-01`;
const MID_YEAR_END = `${YEAR}-06-30`;
const SECOND_HALF_START = `${YEAR}-07-01`;
const PERIOD_END = `${YEAR}-12-31`;

let handle: DbHandle | undefined;

function db(): DbHandle {
  if (!handle) {
    if (!process.env.DATABASE_URL) process.loadEnvFile();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = createDb({ url, max: 2, applicationName: "lfsci-e2e-charges" });
  }
  return handle;
}

test.afterAll(async () => {
  await handle?.close();
  handle = undefined;
});

function only<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`${what} not inserted`);
  return row;
}

async function signUp(page: Page): Promise<string> {
  const slug = `sci-chg-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const email = `${slug}@example.test`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Propriétaire Charges");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-tres-long-1");
  await page.getByLabel("Nom de l’organisation").fill("SCI de démonstration");
  await page.getByLabel("Identifiant court").fill(slug);
  await page.getByRole("button", { name: /Créer le compte/ }).click();
  await page.waitForURL(/localhost:3000\/$/, { timeout: 60_000 });
  return email;
}

async function organizationIdForEmail(email: string): Promise<string> {
  const rows = await db().sql<{ organization_id: string }[]>`
    SELECT m.organization_id FROM membership m
    JOIN app_user u ON u.id = m.app_user_id
    WHERE u.email = ${email} LIMIT 1`;
  const id = rows[0]?.organization_id;
  if (!id) throw new Error(`no organization for ${email}`);
  return id;
}

type Seed = { legalEntityId: string; buildingId: string; unitLabels: [string, string] };

/**
 * CHA-02 fixture: one lot held by two successive tenants on provisions, one lot
 * on a flat fee, and a recoverable building expense not yet spread by a key.
 * The first tenant leaves 180 € of provisions unpaid, which the statement must
 * show apart and never re-invoice.
 */
async function seedCharges(organizationId: string): Promise<Seed> {
  return withTenant(db(), { organizationId }, async (tx) => {
    const legalEntityId = only(
      await tx
        .insert(tables.legalEntity)
        .values({
          organizationId,
          name: "SCI de démonstration",
          legalForm: "sci",
          status: "active",
        })
        .returning({ id: tables.legalEntity.id }),
      "legal_entity",
    ).id;

    const buildingId = only(
      await tx
        .insert(tables.building)
        .values({
          organizationId,
          legalEntityId,
          code: "IMM-1",
          name: "Immeuble d’essai",
          addressLine1: "1 rue de l’Exemple",
          postalCode: "64000",
          city: "Pau",
          status: "active",
        })
        .returning({ id: tables.building.id }),
      "building",
    ).id;

    const units = await tx
      .insert(tables.unit)
      .values(
        ["Appartement A1", "Appartement A2"].map((label, index) => ({
          organizationId,
          buildingId,
          code: `L0${index + 1}`,
          label,
          kind: "dwelling",
          energyClass: "C",
          status: "active",
        })),
      )
      .returning({ id: tables.unit.id });
    const unitA = only(units, "unit A").id;
    const unitB = units[1]?.id;
    if (!unitB) throw new Error("unit B not inserted");

    async function lease(input: {
      reference: string;
      unitId: string;
      startsOn: string;
      endsOn: string;
      chargeRegime: "provision" | "flat_fee";
      tenant: string;
    }): Promise<string> {
      const leaseId = only(
        await tx
          .insert(tables.lease)
          .values({
            organizationId,
            legalEntityId,
            reference: input.reference,
            kind: "bare",
            status: "active",
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            rentExclCharges: "900.00",
            chargeRegime: input.chargeRegime,
            chargeAmount: "60.00",
            paymentDay: 5,
          })
          .returning({ id: tables.lease.id }),
        "lease",
      ).id;
      const personId = only(
        await tx
          .insert(tables.person)
          .values({ organizationId, displayName: input.tenant })
          .returning({ id: tables.person.id }),
        "person",
      ).id;
      await tx.insert(tables.leaseParty).values({
        organizationId,
        leaseId,
        personId,
        role: "holder",
        startsOn: input.startsOn,
      });
      await tx.insert(tables.leaseUnit).values({
        organizationId,
        leaseId,
        unitId: input.unitId,
        role: "main",
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      });
      return leaseId;
    }

    async function provisionTerm(input: {
      leaseId: string;
      start: string;
      end: string;
      charges: string;
      paid: string;
    }): Promise<void> {
      const rentTermId = only(
        await tx
          .insert(tables.rentTerm)
          .values({
            organizationId,
            leaseId: input.leaseId,
            kind: "rent",
            periodStart: input.start,
            periodEnd: input.end,
            dueOn: input.start,
            status: "posted",
          })
          .returning({ id: tables.rentTerm.id }),
        "rent_term",
      ).id;
      const versionId = only(
        await tx
          .insert(tables.rentTermVersion)
          .values({
            organizationId,
            rentTermId,
            sequence: 1,
            rentAmount: "0.00",
            chargeAmount: input.charges,
            accessoryAmount: "0.00",
            totalAmount: input.charges,
            reason: "initial",
          })
          .returning({ id: tables.rentTermVersion.id }),
        "rent_term_version",
      ).id;
      await tx
        .update(tables.rentTerm)
        .set({ currentVersionId: versionId })
        .where(eq(tables.rentTerm.id, rentTermId));

      if (input.paid === "0.00") return;
      const paymentId = only(
        await tx
          .insert(tables.payment)
          .values({
            organizationId,
            legalEntityId,
            direction: "inbound",
            amount: input.paid,
            receivedOn: input.start,
            status: "allocated",
          })
          .returning({ id: tables.payment.id }),
        "payment",
      ).id;
      await tx.insert(tables.paymentAllocation).values({
        organizationId,
        paymentId,
        rentTermId,
        amount: input.paid,
        allocatedOn: input.start,
      });
    }

    const first = await lease({
      reference: "BAIL-A1-1",
      unitId: unitA,
      startsOn: PERIOD_START,
      endsOn: MID_YEAR_END,
      chargeRegime: "provision",
      tenant: "Camille Martin",
    });
    const second = await lease({
      reference: "BAIL-A1-2",
      unitId: unitA,
      startsOn: SECOND_HALF_START,
      endsOn: PERIOD_END,
      chargeRegime: "provision",
      tenant: "Dominique Leroy",
    });
    await lease({
      reference: "BAIL-A2-FORFAIT",
      unitId: unitB,
      startsOn: PERIOD_START,
      endsOn: PERIOD_END,
      chargeRegime: "flat_fee",
      tenant: "Alix Durand",
    });

    await provisionTerm({
      leaseId: first,
      start: PERIOD_START,
      end: MID_YEAR_END,
      charges: "360.00",
      paid: "180.00",
    });
    await provisionTerm({
      leaseId: second,
      start: SECOND_HALF_START,
      end: PERIOD_END,
      charges: "360.00",
      paid: "360.00",
    });

    const supplierId = only(
      await tx
        .insert(tables.supplier)
        .values({ organizationId, name: "Eaux de démonstration", status: "active" })
        .returning({ id: tables.supplier.id }),
      "supplier",
    ).id;
    const expenseId = only(
      await tx
        .insert(tables.expense)
        .values({
          organizationId,
          legalEntityId,
          supplierId,
          documentKind: "invoice",
          supplierReference: "FA-2026-EAU",
          issuedOn: `${YEAR}-12-15`,
          totalInclTax: "1000.00",
          status: "validated",
        })
        .returning({ id: tables.expense.id }),
      "expense",
    ).id;
    const expenseLineId = only(
      await tx
        .insert(tables.expenseLine)
        .values({
          organizationId,
          expenseId,
          lineNumber: 1,
          description: "Eau froide des parties communes",
          amountInclTax: "1000.00",
          chargeNature: "eau",
          recoverableShare: "1",
          servicePeriodStart: PERIOD_START,
          servicePeriodEnd: PERIOD_END,
          unallocatedAmount: "0.00",
        })
        .returning({ id: tables.expenseLine.id }),
      "expense_line",
    ).id;
    await tx.insert(tables.expenseAllocation).values({
      organizationId,
      expenseLineId,
      target: "building_common",
      buildingId,
      amount: "1000.00",
      recoverableAmount: "1000.00",
    });

    return {
      legalEntityId,
      buildingId,
      unitLabels: ["L01 — Appartement A1", "L02 — Appartement A2"],
    };
  });
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the owner versions a key, regularises the provisions and freezes the run", async ({
  page,
}) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  const seed = await seedCharges(organizationId);

  // --- CHA-01: one key, its shares, and nothing active until they total 100 % ---
  await page.goto("/finance/charges/cles");
  await expect(page.getByText(/Aucune clé de répartition/)).toBeVisible({ timeout: 30_000 });
  await assertAccessible(page, "/finance/charges/cles (vide)");

  await page.getByLabel("Code").fill("TANT-IMM1");
  await page.getByLabel("Libellé", { exact: true }).fill("Tantièmes de l’immeuble");
  await choose(page, "Base de répartition", "Tantièmes");
  await choose(page, "Immeuble", "Immeuble d’essai");
  await page.getByLabel("Applicable à partir du").fill(PERIOD_START);
  await page
    .getByLabel("Justification de la règle")
    .fill("Tantièmes de l’état descriptif de division.");

  const firstShare = page.getByRole("group", { name: "Lot 1" });
  await firstShare.getByLabel("Lot", { exact: true }).click();
  await page.getByRole("option", { name: seed.unitLabels[0], exact: true }).click();
  await firstShare.getByLabel("Part", { exact: true }).fill("0.6");

  await page.getByRole("button", { name: "Ajouter un lot" }).first().click();
  const secondShare = page.getByRole("group", { name: "Lot 2" });
  await secondShare.getByLabel("Lot", { exact: true }).click();
  await page.getByRole("option", { name: seed.unitLabels[1], exact: true }).click();
  await secondShare.getByLabel("Part", { exact: true }).fill("0.4");

  // The running total is shown before saving: an inexact key is visibly refused.
  await expect(page.getByTestId("key-new-total")).toContainText("1.000000");
  await page.getByTestId("key-create").click();

  const versionCard = page.getByTestId("key-version-1");
  await expect(versionCard).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("key-version-activate-1").click();
  await expect(versionCard.getByText("Active")).toBeVisible({ timeout: 30_000 });
  await assertAccessible(page, "/finance/charges/cles");

  // --- CHA-02: the run computes, freezes, then never recomputes -------------
  await page.goto("/finance/charges");
  await choose(page, "SCI", "SCI de démonstration");
  await choose(page, "Immeuble", "Immeuble d’essai");
  await page.getByLabel("Début de période").fill(PERIOD_START);
  await page.getByLabel("Fin de période").fill(PERIOD_END);
  await page.getByTestId("run-create").click();
  await page.waitForURL(/\/finance\/charges\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await expect(page.getByTestId("run-source")).toContainText("provisoire", { timeout: 30_000 });
  await page.getByTestId("run-compute").click();
  await expect(page.getByTestId("run-status")).toHaveText("Calculée", { timeout: 30_000 });

  // 600 € on lot A split over two successive tenants, 400 € on the flat-fee lot.
  await expect(page.getByText("Camille Martin")).toBeVisible();
  await expect(page.getByText("Dominique Leroy")).toBeVisible();
  // CHA-02: a flat fee never produces a regularization.
  const excluded = page.getByTestId("run-excluded");
  await expect(excluded).toContainText("BAIL-A2-FORFAIT");
  await expect(excluded).toContainText("Forfait de charges");

  await page.getByTestId("run-freeze").click();
  await expect(page.getByTestId("run-status")).toHaveText("Gelée", { timeout: 30_000 });
  await expect(page.getByTestId("run-source")).toContainText("gelée");
  // A frozen run no longer offers to recompute itself.
  await expect(page.getByTestId("run-compute")).toBeDisabled();

  await assertAccessible(page, "/finance/charges/[id]");

  // --- ARC-02: closing only prepares the accounting commands ---------------
  await page.getByTestId("run-close").click();
  await expect(page.getByTestId("run-status")).toHaveText("Ajustements préparés", {
    timeout: 30_000,
  });

  const commands = await withTenant(db(), { organizationId }, async (tx) =>
    tx
      .select({
        status: tables.command.status,
        autonomyLevel: tables.command.autonomyLevel,
        payload: tables.command.payload,
      })
      .from(tables.command)
      .where(eq(tables.command.commandType, "prepare_rent_accounting")),
  );
  expect(commands.length).toBeGreaterThan(0);
  expect(commands.every((command) => command.status === "prepared")).toBe(true);

  // The adjustment is the difference against the provisions CALLED: the 180 €
  // called and unpaid stay in the tenant account, they are not re-invoiced.
  const lines = await withTenant(db(), { organizationId }, async (tx) =>
    tx
      .select({
        recoverable: tables.provisionRegularizationLine.recoverableAmount,
        called: tables.provisionRegularizationLine.provisionsCalled,
        unpaid: tables.provisionRegularizationLine.provisionsUnpaid,
        balance: tables.provisionRegularizationLine.balanceAmount,
      })
      .from(tables.provisionRegularizationLine),
  );
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(Number(line.balance)).toBeCloseTo(Number(line.recoverable) - Number(line.called), 2);
  }
  expect(lines.some((line) => line.unpaid === "180.00")).toBe(true);
});

test("the statement is only offered once the run is frozen", async ({ page, isMobile }) => {
  const email = await signUp(page);
  const organizationId = await organizationIdForEmail(email);
  await seedCharges(organizationId);

  await page.goto("/finance/charges");
  await choose(page, "SCI", "SCI de démonstration");
  await page.getByLabel("Début de période").fill(PERIOD_START);
  await page.getByLabel("Fin de période").fill(PERIOD_END);
  await page.getByTestId("run-create").click();
  await page.waitForURL(/\/finance\/charges\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  // No active key yet: the calculation says why instead of showing a number.
  await page.getByTestId("run-compute").click();
  await expect(page.getByTestId("run-blocked")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("run-blocked")).toContainText("clé de répartition");
  // The control stays on screen, disabled, so the feature never looks absent.
  await expect(page.getByTestId("run-freeze")).toBeDisabled();

  if (isMobile) {
    // UX-02: the sidebar is a drawer on a phone; the module must be reachable.
    await page.goto("/");
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Charges" }).click();
    await expect(page).toHaveURL(/\/finance\/charges$/);
    await expect(page.getByRole("dialog")).toBeHidden();
  }

  await assertAccessible(page, "/finance/charges");
});
