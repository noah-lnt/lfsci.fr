import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  completeExchange,
  findExchangesByRequestId,
  purgeExchanges,
  recordExchange,
} from "../../src/exchange";
import { withoutTenant, withTenant } from "../../src/tenant";
import { adminDb, seedTwoOrganizations, testDb } from "./helpers";

const requestId = "44444444-4444-4444-8444-444444444444";

describe("integration exchanges", () => {
  it("stores request and response with secrets redacted", async () => {
    const { orgA } = await seedTwoOrganizations();

    const stored = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const created = await recordExchange(tx, {
        organizationId: orgA,
        requestId,
        integration: "odoo",
        direction: "outbound",
        operation: "account.move/create",
        request: { apiKey: "super-secret", body: { iban: "FR7612345678901234567890123" } },
      });
      await completeExchange(tx, created.id, {
        response: { id: 42, token: "another-secret" },
        status: "success",
        httpStatus: 200,
        durationMs: 120,
      });
      return findExchangesByRequestId(tx, requestId);
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.request).toMatchObject({
      apiKey: "[redacted]",
      body: { iban: "[redacted]" },
    });
    expect(stored[0]?.response).toMatchObject({ id: 42, token: "[redacted]" });
    expect(stored[0]?.status).toBe("success");
  });

  it("purges rows older than the retention window", async () => {
    const { orgA } = await seedTwoOrganizations();
    await withTenant(testDb(), { organizationId: orgA }, (tx) =>
      recordExchange(tx, {
        organizationId: orgA,
        integration: "odoo",
        direction: "outbound",
        operation: "res.partner/search_read",
        request: {},
      }),
    );
    await adminDb().db.execute(
      sql`UPDATE integration_exchange SET created_at = now() - interval '40 days'`,
    );

    const removed = await withoutTenant(adminDb(), (tx) => purgeExchanges(tx, 30));
    expect(removed).toBe(1);
  });
});
