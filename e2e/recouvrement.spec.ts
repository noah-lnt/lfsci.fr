import { expect, test } from "@playwright/test";
// Playwright compiles specs as CommonJS; the template module is imported directly
// so the asserted version cannot drift from the one the app renders.
import { REMINDER_TEMPLATE_VERSION } from "../packages/integrations/mail/src/templates";
import { closeDb, db, isoDaysFromToday, type Owner, signUpOwner } from "./helpers/accueil-fixtures";
import { assertAccessible } from "./helpers/axe";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.afterAll(closeDb);

const REFERENCE = "BAIL-REC-001";
const TENANT = "Camille Martin";

/** One active lease with a single rent term 40 days overdue and untouched. */
async function seedOverdueLease(owner: Owner): Promise<void> {
  const dueOn = isoDaysFromToday(-40);
  const periodStart = isoDaysFromToday(-70);
  const periodEnd = isoDaysFromToday(-41);

  const persons = await db().sql<{ id: string }[]>`
    INSERT INTO person (organization_id, display_name)
    VALUES (${owner.organizationId}::uuid, ${TENANT}) RETURNING id`;
  const personId = persons[0]?.id as string;

  await db().sql`
    INSERT INTO contact_point (organization_id, person_id, kind, value, is_primary)
    VALUES (${owner.organizationId}::uuid, ${personId}::uuid, 'email',
            'camille.martin@example.test', true)`;

  const leases = await db().sql<{ id: string }[]>`
    INSERT INTO lease (organization_id, legal_entity_id, reference, kind, status, starts_on,
                       rent_excl_charges, charge_amount, currency, payment_day)
    VALUES (${owner.organizationId}::uuid, ${owner.legalEntityId}::uuid, ${REFERENCE}, 'bare',
            'active', ${periodStart}::date, 700.00, 80.00, 'EUR', 5)
    RETURNING id`;
  const leaseId = leases[0]?.id as string;

  await db().sql`
    INSERT INTO lease_party (organization_id, lease_id, person_id, role, starts_on,
                             is_billing_contact)
    VALUES (${owner.organizationId}::uuid, ${leaseId}::uuid, ${personId}::uuid, 'holder',
            ${periodStart}::date, true)`;

  const terms = await db().sql<{ id: string }[]>`
    INSERT INTO rent_term (organization_id, lease_id, kind, period_start, period_end, due_on,
                           status)
    VALUES (${owner.organizationId}::uuid, ${leaseId}::uuid, 'rent', ${periodStart}::date,
            ${periodEnd}::date, ${dueOn}::date, 'posted')
    RETURNING id`;
  const termId = terms[0]?.id as string;

  const versions = await db().sql<{ id: string }[]>`
    INSERT INTO rent_term_version (organization_id, rent_term_id, sequence, rent_amount,
                                   charge_amount, accessory_amount, total_amount, currency, reason)
    VALUES (${owner.organizationId}::uuid, ${termId}::uuid, 1, 700.00, 80.00, 0.00, 780.00,
            'EUR', 'initial')
    RETURNING id`;
  await db().sql`
    UPDATE rent_term SET current_version_id = ${versions[0]?.id as string}::uuid
     WHERE id = ${termId}::uuid`;
}

async function reminderCommand(
  organizationId: string,
): Promise<{ status: string; level: string; channel: string; availableAt: string } | undefined> {
  const rows = await db().sql<
    { status: string; level: string; channel: string; available_at: string }[]
  >`
    SELECT c.status, c.autonomy_level AS level, o.channel,
           to_char(o.available_at, 'YYYY') AS available_at
      FROM command c
      JOIN outbox_entry o ON o.command_id = c.id
     WHERE c.command_type = 'send_message' AND c.organization_id = ${organizationId}::uuid
     LIMIT 1`;
  const row = rows[0];
  return row
    ? {
        status: row.status,
        level: row.level,
        channel: row.channel,
        availableAt: row.available_at,
      }
    : undefined;
}

test("an overdue lease surfaces on the recouvrement screen and proposes the next reminder", async ({
  page,
}) => {
  const owner = await signUpOwner(page);

  // 1. Cold screen: the module says what it will hold rather than staying blank.
  await page.goto("/locations/recouvrement");
  await expect(page.getByRole("heading", { name: "Recouvrement", level: 1 })).toBeVisible();
  await expect(page.getByText(/Aucun impayé à cette date/)).toBeVisible();
  await expect(page.getByText(/Ces délais sont des valeurs par défaut/)).toBeVisible();
  await assertAccessible(page, "/locations/recouvrement (vide)");

  // 2. Who is late, by how much and since when.
  await seedOverdueLease(owner);
  await page.reload();

  const row = page.getByTestId("arrears-row");
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await expect(row).toContainText(REFERENCE);
  await expect(row).toContainText(TENANT);
  await expect(row).toContainText("780,00");
  await expect(row).toContainText("Exigible et impayé");
  await expect(row).toContainText("Relance simple");

  const card = page.getByTestId("arrears-card");
  await expect(card.getByTestId("arrears-term-row")).toHaveCount(1);
  await expect(card.getByTestId("reminder-history-empty")).toBeVisible();

  // 3. The action is always rendered, and says which level it would prepare.
  const propose = card.getByTestId("propose-reminder");
  await expect(propose).toBeVisible();
  await expect(propose).toBeEnabled();
  await expect(propose).toContainText("Relance simple");
  await expect(card.getByTestId("propose-hint")).toContainText("niveau C");

  await assertAccessible(page, "/locations/recouvrement (impayé)");

  // 4. Preparing shows the exact message; nothing leaves without an approval.
  await propose.click();
  const preview = page.getByTestId("reminder-preview");
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview).toContainText("Loyer en attente");
  await expect(preview).toContainText("780,00 EUR");
  await expect(preview.getByRole("link", { name: "Ouvrir les validations" })).toHaveAttribute(
    "href",
    "/validations",
  );

  await expect
    .poll(async () => (await reminderCommand(owner.organizationId))?.status, { timeout: 20_000 })
    .toBe("prepared");
  const command = await reminderCommand(owner.organizationId);
  expect(command?.level).toBe("C");
  expect(command?.channel).toBe("email");
  // Parked far in the future: only the approval moves it into the dispatcher's reach.
  expect(command?.availableAt).toBe("2999");

  // 5. The history now carries the template and its version.
  await expect(page.getByTestId("reminder-row")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("reminder-row")).toContainText(REMINDER_TEMPLATE_VERSION);

  // 6. The action stays offered: proposing again reuses the same command and message.
  await expect(card.getByTestId("propose-reminder")).toBeVisible();

  await assertAccessible(page, "/locations/recouvrement (relance préparée)");
});

test("a disputed lease suspends the ladder and says so", async ({ page }) => {
  const owner = await signUpOwner(page);
  await seedOverdueLease(owner);
  await db().sql`
    UPDATE lease SET status = 'disputed' WHERE organization_id = ${owner.organizationId}::uuid`;

  await page.goto("/locations/recouvrement");
  const row = page.getByTestId("arrears-row");
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await expect(row).toContainText("Dossier contesté");

  const card = page.getByTestId("arrears-card");
  // UX: the control stays rendered and disabled, with the reason next to it.
  await expect(card.getByTestId("propose-reminder")).toBeDisabled();
  await expect(card.getByTestId("propose-hint")).toContainText("suspendue");

  await assertAccessible(page, "/locations/recouvrement (suspendu)");
});
