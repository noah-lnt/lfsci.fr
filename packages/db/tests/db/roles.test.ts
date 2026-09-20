import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "../../src/tenant";
import { adminDb, insertLegalEntity, pgErrorOf, seedTwoOrganizations, testDb } from "./helpers";

type RoleRow = {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcanlogin: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
};

async function roles(): Promise<Map<string, RoleRow>> {
  const rows = await adminDb().db.execute<RoleRow>(sql`
    SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
      FROM pg_roles
     WHERE rolname IN ('lfsci_app', 'lfsci_service', 'lfsci_maintenance')
  `);
  return new Map([...rows].map((row) => [row.rolname, row]));
}

/** Runs one statement under `role`, inside a transaction of its own. */
async function asRole<T extends Record<string, unknown>>(
  role: string,
  statement: ReturnType<typeof sql>,
): Promise<T[]> {
  return adminDb().db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
    const rows = await tx.execute<T>(statement);
    return [...rows] as T[];
  });
}

describe("production database roles", () => {
  it("gives each role only the attributes its job needs", async () => {
    const found = await roles();

    expect(found.get("lfsci_app")).toMatchObject({ rolcanlogin: false, rolbypassrls: false });
    expect(found.get("lfsci_service")).toMatchObject({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    expect(found.get("lfsci_maintenance")).toMatchObject({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: true,
    });
  });

  it("lets the service role switch into lfsci_app and keeps maintenance apart", async () => {
    const rows = await adminDb().db.execute<{ service: boolean; maintenance: boolean }>(sql`
      SELECT pg_has_role('lfsci_service', 'lfsci_app', 'MEMBER') AS service,
             pg_has_role('lfsci_maintenance', 'lfsci_app', 'MEMBER') AS maintenance
    `);
    expect([...rows][0]).toEqual({ service: true, maintenance: false });
  });

  it("hides another organization's rows from the application role", async () => {
    const { orgA, orgB } = await seedTwoOrganizations();
    const entityB = await insertLegalEntity(orgB, "SCI B");

    const seen = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const rows = await tx.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM legal_entity WHERE id = ${entityB}::uuid`,
      );
      return [...rows][0]?.count;
    });

    expect(seen).toBe("0");
  });

  it("hides it from the service login role too, even without the role switch", async () => {
    const { orgA, orgB } = await seedTwoOrganizations();
    await insertLegalEntity(orgA, "SCI A");
    await insertLegalEntity(orgB, "SCI B");

    const names = await adminDb().db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organization_id', ${orgA}, true)`);
      await tx.execute(sql.raw("SET LOCAL ROLE lfsci_service"));
      const rows = await tx.execute<{ name: string }>(sql`SELECT name FROM legal_entity`);
      return [...rows].map((row) => row.name);
    });

    expect(names).toEqual(["SCI A"]);
  });

  it("reads every organization from the maintenance role and none from the service role", async () => {
    await seedTwoOrganizations();
    const registry = sql`SELECT code FROM organization ORDER BY code`;

    const swept = await asRole<{ code: string }>("lfsci_maintenance", registry);
    const denied = await asRole<{ code: string }>("lfsci_service", registry);

    expect(swept.map((row) => row.code)).toEqual(["org-a", "org-b"]);
    expect(denied).toEqual([]);
  });

  it("keeps the maintenance role off the business tables it never sweeps", async () => {
    const { orgA } = await seedTwoOrganizations();
    await insertLegalEntity(orgA, "SCI A");

    const message = await pgErrorOf(
      asRole("lfsci_maintenance", sql`SELECT name FROM legal_entity`),
    );

    expect(message).toMatch(/permission denied for table legal_entity/i);
  });

  it("refuses DDL to the application role", async () => {
    const { orgA } = await seedTwoOrganizations();

    const created = await pgErrorOf(
      withTenant(testDb(), { organizationId: orgA }, (tx) =>
        tx.execute(sql.raw("CREATE TABLE ddl_probe (id integer)")),
      ),
    );
    expect(created).toMatch(/permission denied for schema public/i);

    const altered = await pgErrorOf(
      withTenant(testDb(), { organizationId: orgA }, (tx) =>
        tx.execute(sql.raw("ALTER TABLE legal_entity ADD COLUMN ddl_probe text")),
      ),
    );
    expect(altered).toMatch(/must be owner/i);

    const dropped = await pgErrorOf(
      withTenant(testDb(), { organizationId: orgA }, (tx) =>
        tx.execute(sql.raw("DROP TABLE legal_entity")),
      ),
    );
    expect(dropped).toMatch(/must be owner/i);
  });

  it("refuses to rewrite the audit trail even inside its own organization", async () => {
    const { orgA } = await seedTwoOrganizations();

    const message = await pgErrorOf(
      withTenant(testDb(), { organizationId: orgA }, (tx) =>
        tx.execute(sql.raw("DELETE FROM audit_log")),
      ),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it("grants the application role a table created after the migration", async () => {
    const db = adminDb().db;
    await db.execute(sql.raw("CREATE TABLE default_privilege_probe (id integer)"));
    try {
      const rows = await db.execute<{ allowed: boolean }>(sql`
        SELECT has_table_privilege('lfsci_app', 'default_privilege_probe', 'SELECT, INSERT, UPDATE, DELETE')
               AS allowed
      `);
      expect([...rows][0]?.allowed).toBe(true);
    } finally {
      await db.execute(sql.raw("DROP TABLE default_privilege_probe"));
    }
  });
});
