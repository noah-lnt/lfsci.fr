import type { tables } from "@lfsci/db";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mapFixedAssetPosition, withDebitMatch } = await import("./mappers");

type FixedAssetRow = typeof tables.fixedAsset.$inferSelect;

const ID = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function asset(overrides: Partial<FixedAssetRow> = {}): FixedAssetRow {
  return {
    id: ID,
    organizationId: ID,
    legalEntityId: ID,
    buildingId: null,
    unitId: null,
    label: "Immeuble",
    grossValue: "300000.00",
    landValue: "60000.00",
    currency: "EUR",
    commissionedOn: "2020-01-01",
    durationYears: "30.000000",
    method: "linear",
    accumulatedDepreciation: "0.00",
    netBookValue: null,
    disposedOn: null,
    odooAssetId: null,
    odooReadAt: null,
    status: "running",
    // Postgres renders timestamptz without the ISO "T"; the mapper normalises it.
    createdAt: "2026-09-20 06:30:00+00",
    updatedAt: null,
    version: 1,
    ...overrides,
  } as FixedAssetRow;
}

describe("mapFixedAssetPosition — IMM-01 / IMM-02", () => {
  it("never depreciates the land", () => {
    // The domain accumulates inclusively, so ten full years end on 2029-12-31.
    const position = mapFixedAssetPosition(asset(), "2029-12-31");
    expect(position.depreciableGross).toBe("240000.00");
    expect(position.accumulatedAt).toBe("80000.00");
    expect(position.netBookValueAt).toBe("220000.00");
  });

  it("counts the read date itself", () => {
    expect(mapFixedAssetPosition(asset(), "2030-01-01").accumulatedAt).toBe("80021.51");
  });

  it("applies the house default duration and says so", () => {
    const position = mapFixedAssetPosition(
      asset({ durationYears: null, accumulatedDepreciation: "12000.00" }),
      "2030-01-01",
    );
    expect(position.durationSource).toBe("default");
    expect(position.durationMonths).toBe(360);
    expect(position.accumulatedAt).toBe("80021.51");
  });

  it("reads a duration entered on the asset as the asset's own", () => {
    expect(mapFixedAssetPosition(asset(), "2030-01-01").durationSource).toBe("asset");
  });

  it("honours an explicit 'none' method", () => {
    const position = mapFixedAssetPosition(
      asset({ method: "none", accumulatedDepreciation: "0.00" }),
      "2030-01-01",
    );
    expect(position.accumulatedAt).toBe("0.00");
    expect(position.netBookValueAt).toBe("300000.00");
    expect(position.durationSource).toBe("none");
  });

  it("counts the components it was given", () => {
    expect(mapFixedAssetPosition(asset(), "2030-01-01", 3).componentCount).toBe(3);
  });

  it("normalises the Postgres timestamp to an ISO instant", () => {
    expect(mapFixedAssetPosition(asset(), "2030-01-01").createdAt).toBe("2026-09-20T06:30:00.000Z");
  });

  it("dates the position it computed", () => {
    expect(mapFixedAssetPosition(asset(), "2030-01-01").computedOn).toBe("2030-01-01");
  });
});

describe("withDebitMatch — WF-08", () => {
  const installment = {
    id: ID,
    createdAt: "2026-09-20T06:30:00.000Z",
    updatedAt: null,
    version: 1,
    scheduleVersionId: ID,
    installmentNumber: 1,
    dueOn: "2026-10-05",
    principalAmount: "700.00",
    interestAmount: "250.00",
    insuranceAmount: "50.00",
    feesAmount: "0.00",
    totalAmount: "1000.00",
    remainingPrincipal: "99300.00",
    currency: "EUR",
    bankTransactionId: null,
    matchedAt: null,
    varianceReason: null,
    status: "forecast" as const,
  };

  it("reports an exact match", () => {
    expect(withDebitMatch(installment, "1000.00")).toMatchObject({
      matchStatus: "exact",
      matchDifference: "0.00",
    });
  });

  it("reports the difference rather than a silent match", () => {
    expect(withDebitMatch(installment, "1002.50")).toMatchObject({
      matchStatus: "amount_mismatch",
      matchDifference: "2.50",
    });
  });

  it("says when no debit was found instead of claiming a match", () => {
    expect(withDebitMatch(installment, null)).toMatchObject({
      matchStatus: "no_debit",
      matchDifference: null,
    });
  });
});
