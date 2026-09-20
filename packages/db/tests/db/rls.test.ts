import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ensureObjectRef } from "../../src/object-ref";
import { withTenant } from "../../src/tenant";
import { adminDb, insertLegalEntity, pgErrorOf, seedTwoOrganizations, testDb } from "./helpers";

describe("row level security", () => {
  it("shows an organization only its own rows", async () => {
    const { orgA, orgB } = await seedTwoOrganizations();
    await insertLegalEntity(orgA, "SCI A");
    await insertLegalEntity(orgB, "SCI B");

    const seenByA = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const rows = await tx.execute<{ name: string }>(sql`SELECT name FROM legal_entity`);
      return [...rows].map((r) => r.name);
    });

    expect(seenByA).toEqual(["SCI A"]);
  });

  it("runs the transaction as the application role, not the owner", async () => {
    const { orgA } = await seedTwoOrganizations();
    const role = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const rows = await tx.execute<{ role: string }>(sql`SELECT current_user AS role`);
      return [...rows][0]?.role;
    });
    expect(role).toBe("lfsci_app");
  });

  it("refuses an insert tagged with another organization", async () => {
    const { orgA, orgB } = await seedTwoOrganizations();
    const message = await pgErrorOf(
      withTenant(testDb(), { organizationId: orgA }, (tx) =>
        tx.execute(
          sql`INSERT INTO legal_entity (organization_id, name) VALUES (${orgB}::uuid, 'SCI volée')`,
        ),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("returns nothing when the tenant setting is missing", async () => {
    const { orgA } = await seedTwoOrganizations();
    await insertLegalEntity(orgA, "SCI A");

    const rows = await testDb().db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE lfsci_app"));
      const found = await tx.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM legal_entity`,
      );
      return [...found][0]?.count;
    });

    expect(rows).toBe("0");
  });

  it("refuses an object_ref pointing at another organization's row", async () => {
    const { orgA, orgB } = await seedTwoOrganizations();
    const entityB = await insertLegalEntity(orgB, "SCI B");

    const message = await pgErrorOf(
      withTenant(testDb(), { organizationId: orgA }, (tx) =>
        ensureObjectRef(tx, { organizationId: orgA, kind: "legal_entity", id: entityB }),
      ),
    );
    expect(message).toMatch(/foreign key constraint/i);
  });

  it("creates one registry row per object and is idempotent", async () => {
    const { orgA } = await seedTwoOrganizations();
    const entityA = await insertLegalEntity(orgA, "SCI A");

    const [first, second] = await withTenant(testDb(), { organizationId: orgA }, async (tx) => [
      await ensureObjectRef(tx, { organizationId: orgA, kind: "legal_entity", id: entityA }),
      await ensureObjectRef(tx, { organizationId: orgA, kind: "legal_entity", id: entityA }),
    ]);

    expect(first).toBe(second);
    const rows = await adminDb().db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM object_ref`,
    );
    expect([...rows][0]?.count).toBe("1");
  });
});
