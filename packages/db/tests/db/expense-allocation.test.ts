import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "../../src/tenant";
import { insertLegalEntity, pgErrorOf, seedTwoOrganizations, testDb } from "./helpers";

async function fixture(organizationId: string) {
  const legalEntityId = await insertLegalEntity(organizationId, "SCI A");
  return withTenant(testDb(), { organizationId }, async (tx) => {
    const buildings = await tx.execute<{ id: string }>(sql`
      INSERT INTO building (organization_id, legal_entity_id, code, name, address_line1)
      VALUES (${organizationId}::uuid, ${legalEntityId}::uuid, 'LIL', 'Résidence des Lilas', '12 rue des Lilas')
      RETURNING id
    `);
    const buildingId = [...buildings][0]?.id;
    const units = await tx.execute<{ id: string }>(sql`
      INSERT INTO unit (organization_id, building_id, code, label, kind)
      VALUES (${organizationId}::uuid, ${buildingId}::uuid, 'LIL-01', 'Appartement 1', 'dwelling')
      RETURNING id
    `);
    const unitId = [...units][0]?.id;
    const expenses = await tx.execute<{ id: string }>(sql`
      INSERT INTO expense (organization_id, legal_entity_id, document_kind, total_incl_tax)
      VALUES (${organizationId}::uuid, ${legalEntityId}::uuid, 'invoice', 600.00)
      RETURNING id
    `);
    const expenseId = [...expenses][0]?.id;
    const lines = await tx.execute<{ id: string }>(sql`
      INSERT INTO expense_line (organization_id, expense_id, line_number, description, amount_incl_tax, unallocated_amount)
      VALUES (${organizationId}::uuid, ${expenseId}::uuid, 1, 'Entretien chaudière', 600.00, 0.00)
      RETURNING id
    `);
    return { buildingId, unitId, lineId: [...lines][0]?.id };
  });
}

describe("expense allocation balance", () => {
  it("commits when allocations plus residual equal the line", async () => {
    const { orgA } = await seedTwoOrganizations();
    const { unitId, buildingId, lineId } = await fixture(orgA);

    await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      await tx.execute(sql`
        INSERT INTO expense_allocation (organization_id, expense_line_id, target, unit_id, amount)
        VALUES (${orgA}::uuid, ${lineId}::uuid, 'unit', ${unitId}::uuid, 250.00)
      `);
      await tx.execute(sql`
        INSERT INTO expense_allocation (organization_id, expense_line_id, target, building_id, amount)
        VALUES (${orgA}::uuid, ${lineId}::uuid, 'building_common', ${buildingId}::uuid, 350.00)
      `);
    });

    const rows = await withTenant(testDb(), { organizationId: orgA }, (tx) =>
      tx.execute<{ total: string }>(
        sql`SELECT coalesce(sum(amount), 0)::text AS total FROM expense_allocation`,
      ),
    );
    expect([...rows][0]?.total).toBe("600.00");
  });

  it("fails at commit when the allocations do not add up", async () => {
    const { orgA } = await seedTwoOrganizations();
    const { unitId, lineId } = await fixture(orgA);

    const message = await pgErrorOf(
      withTenant(testDb(), { organizationId: orgA }, (tx) =>
        tx.execute(sql`
          INSERT INTO expense_allocation (organization_id, expense_line_id, target, unit_id, amount)
          VALUES (${orgA}::uuid, ${lineId}::uuid, 'unit', ${unitId}::uuid, 500.00)
        `),
      ),
    );
    expect(message).toMatch(/allocations .* <> line amount/);
  });
});
