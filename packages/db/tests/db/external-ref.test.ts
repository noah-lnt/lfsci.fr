import { isAppError } from "@lfsci/kernel";
import { describe, expect, it } from "vitest";
import { findByExternal, findByInternal, mapExternal } from "../../src/external-ref";
import { withTenant } from "../../src/tenant";
import { insertLegalEntity, seedTwoOrganizations, testDb } from "./helpers";

const base = (organizationId: string, internalId: string) => ({
  organizationId,
  model: "account.move",
  externalId: 4211,
  internalId,
  internalTable: "expense",
  odooDatabase: "lfsci-test",
  company: 1,
});

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not-an-AppError: ${String(error)}`;
}

describe("external references", () => {
  it("maps once and reads back both ways", async () => {
    const { orgA } = await seedTwoOrganizations();
    const internalId = await insertLegalEntity(orgA, "SCI A");

    const outcome = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      const created = await mapExternal(tx, base(orgA, internalId));
      const again = await mapExternal(tx, base(orgA, internalId));
      return {
        created,
        again,
        byExternal: await findByExternal(tx, {
          organizationId: orgA,
          odooDatabase: "lfsci-test",
          model: "account.move",
          externalId: "4211",
        }),
        byInternal: await findByInternal(tx, {
          organizationId: orgA,
          model: "account.move",
          internalId,
        }),
      };
    });

    expect(outcome.again.id).toBe(outcome.created.id);
    expect(outcome.byExternal?.internalId).toBe(internalId);
    expect(outcome.byInternal?.externalId).toBe("4211");
  });

  it("refuses a second internal object behind the same external identity", async () => {
    const { orgA } = await seedTwoOrganizations();
    const first = await insertLegalEntity(orgA, "SCI A");
    const second = await insertLegalEntity(orgA, "SCI A bis");

    const error = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      await mapExternal(tx, base(orgA, first));
      return mapExternal(tx, base(orgA, second)).catch((e: unknown) => e);
    });
    expect(codeOf(error)).toBe("CONFLICT");
  });

  it("refuses a second external identity for the same internal object", async () => {
    const { orgA } = await seedTwoOrganizations();
    const internalId = await insertLegalEntity(orgA, "SCI A");

    const error = await withTenant(testDb(), { organizationId: orgA }, async (tx) => {
      await mapExternal(tx, base(orgA, internalId));
      return mapExternal(tx, { ...base(orgA, internalId), externalId: 9999 }).catch(
        (e: unknown) => e,
      );
    });
    expect(codeOf(error)).toBe("CONFLICT");
  });
});
