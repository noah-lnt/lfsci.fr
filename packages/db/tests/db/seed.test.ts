import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SEED_IDS, seed } from "../../src/seed";
import { adminDb, testDb } from "./helpers";

async function counts(): Promise<Record<string, string>> {
  const rows = await adminDb().db.execute<{ table: string; count: string }>(sql`
    SELECT 'unit' AS table, count(*)::text AS count FROM unit
    UNION ALL SELECT 'lease', count(*)::text FROM lease
    UNION ALL SELECT 'rent_term', count(*)::text FROM rent_term
    UNION ALL SELECT 'payment_allocation', count(*)::text FROM payment_allocation
    UNION ALL SELECT 'expense_allocation', count(*)::text FROM expense_allocation
    UNION ALL SELECT 'loan_installment', count(*)::text FROM loan_installment
    UNION ALL SELECT 'cca_movement', count(*)::text FROM cca_movement
    UNION ALL SELECT 'asset_component', count(*)::text FROM asset_component
    UNION ALL SELECT 'object_ref', count(*)::text FROM object_ref
    UNION ALL SELECT 'activity_link', count(*)::text FROM activity_link
    UNION ALL SELECT 'event_link', count(*)::text FROM event_link
    UNION ALL SELECT 'deadline_link', count(*)::text FROM deadline_link
    UNION ALL SELECT 'inbox_item', count(*)::text FROM inbox_item
  `);
  return Object.fromEntries([...rows].map((r) => [r.table, r.count]));
}

describe("seed", () => {
  it("is idempotent", async () => {
    const first = await seed(testDb());
    expect(first.organizationId).toBe(SEED_IDS.organization);
    const afterFirst = await counts();

    await seed(testDb());
    const afterSecond = await counts();

    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst.unit).toBe("10");
    expect(afterFirst.lease).toBe("2");
    expect(afterFirst.rent_term).toBe("4");
    expect(afterFirst.expense_allocation).toBe("3");
  });
});
