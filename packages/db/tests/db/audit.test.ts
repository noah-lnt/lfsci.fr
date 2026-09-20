import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordAudit, verifyAuditChain } from "../../src/audit";
import { withTenant } from "../../src/tenant";
import { adminDb, pgErrorOf, seedTwoOrganizations, testDb } from "./helpers";

async function appendThree(organizationId: string) {
  return withTenant(testDb(), { organizationId }, async (tx) => {
    const rows = [];
    for (const action of ["create", "update", "post"]) {
      rows.push(
        await recordAudit(tx, {
          organizationId,
          actorKind: "user",
          objectTable: "lease",
          action,
          afterValue: { action, amount: "680.00" },
        }),
      );
    }
    return rows;
  });
}

describe("audit log", () => {
  it("chains hashes and verifies clean", async () => {
    const { orgA } = await seedTwoOrganizations();
    const rows = await appendThree(orgA);

    expect(rows[0]?.previousHash).toBeNull();
    expect(rows[1]?.previousHash).toBe(rows[0]?.hash);
    expect(rows[2]?.previousHash).toBe(rows[1]?.hash);

    const broken = await withTenant(testDb(), { organizationId: orgA }, (tx) =>
      verifyAuditChain(tx, orgA),
    );
    expect(broken).toBeNull();
  });

  it("keeps organizations on separate chains", async () => {
    const { orgA, orgB } = await seedTwoOrganizations();
    await appendThree(orgA);
    await appendThree(orgB);

    for (const organizationId of [orgA, orgB]) {
      const broken = await withTenant(testDb(), { organizationId }, (tx) =>
        verifyAuditChain(tx, organizationId),
      );
      expect(broken).toBeNull();
    }
  });

  it("refuses an update from the owner", async () => {
    const { orgA } = await seedTwoOrganizations();
    const rows = await appendThree(orgA);
    const message = await pgErrorOf(
      adminDb().db.execute(
        sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${rows[1]?.id}::uuid`,
      ),
    );
    expect(message).toMatch(/append-only/);
  });

  it("detects a tampered row once the append-only trigger is bypassed", async () => {
    const { orgA } = await seedTwoOrganizations();
    const rows = await appendThree(orgA);
    const target = rows[1];
    if (!target) throw new Error("missing audit row");

    const admin = adminDb().db;
    await admin.execute(sql.raw("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only"));
    await admin.execute(
      sql`UPDATE audit_log SET after_value = '{"amount":"9999.00"}'::jsonb WHERE id = ${target.id}::uuid`,
    );
    await admin.execute(sql.raw("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only"));

    const broken = await withTenant(testDb(), { organizationId: orgA }, (tx) =>
      verifyAuditChain(tx, orgA),
    );
    expect(broken?.id).toBe(target.id);
    expect(broken?.reason).toBe("hash_mismatch");
  });
});
