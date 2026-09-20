import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Component graph; the boundary it
// guards is a lint concern, not something this pure-function test exercises.
vi.mock("server-only", () => ({}));

const { planAllocation } = await import("./allocation");
const { AllocateExpenseInput } = await import("@/lib/contracts/finance");

const EXPENSE = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const UNIT_A = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01";
const UNIT_B = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02";
const ENTITY = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03";

function input(line: {
  targets: { target: "unit" | "entity_common"; unitId?: string; share: string }[];
  unallocatedShare?: string;
  recoverableShare?: string;
}) {
  return AllocateExpenseInput.parse({
    id: EXPENSE,
    expectedVersion: 1,
    lines: [
      {
        lineNumber: 1,
        ...(line.recoverableShare ? { recoverableShare: line.recoverableShare } : {}),
        ...(line.unallocatedShare ? { unallocatedShare: line.unallocatedShare } : {}),
        targets: line.targets.map((target) => ({
          target: target.target,
          ...(target.unitId ? { unitId: target.unitId } : {}),
          ...(target.target === "entity_common" ? { legalEntityId: ENTITY } : {}),
          share: target.share,
        })),
      },
    ],
  });
}

const lines = [{ lineNumber: 1, amountInclTax: "100.00", recoverableShare: "0" }];

describe("planAllocation — CHA-01 / F05", () => {
  it("splits a line in half to the cent", () => {
    const plan = planAllocation(
      input({
        targets: [
          { target: "unit", unitId: UNIT_A, share: "0.5" },
          { target: "unit", unitId: UNIT_B, share: "0.5" },
        ],
      }),
      lines,
    );
    expect(plan.lines[0]?.allocations.map((a) => a.amount)).toEqual(["50.00", "50.00"]);
    expect(plan.totalAllocated).toBe("100.00");
    expect(plan.totalUnallocated).toBe("0.00");
  });

  it("keeps an uneven split exact, the residue going to the largest remainder", () => {
    const plan = planAllocation(
      input({
        targets: [
          { target: "unit", unitId: UNIT_A, share: "0.333333" },
          { target: "unit", unitId: UNIT_B, share: "0.666667" },
        ],
      }),
      lines,
    );
    const amounts = plan.lines[0]?.allocations.map((a) => a.amount) ?? [];
    expect(amounts).toEqual(["33.33", "66.67"]);
    expect(plan.totalAllocated).toBe("100.00");
  });

  it("carries an explicit residual so allocations plus residue equal the line", () => {
    const plan = planAllocation(
      input({
        targets: [{ target: "unit", unitId: UNIT_A, share: "0.8" }],
        unallocatedShare: "0.2",
      }),
      lines,
    );
    expect(plan.lines[0]?.allocations[0]?.amount).toBe("80.00");
    expect(plan.lines[0]?.unallocatedAmount).toBe("20.00");
    expect(plan.totalAllocated).toBe("80.00");
    expect(plan.totalUnallocated).toBe("20.00");
  });

  it("refuses shares that do not total 100 %", () => {
    expect(() =>
      planAllocation(input({ targets: [{ target: "unit", unitId: UNIT_A, share: "0.5" }] }), lines),
    ).toThrow(/100 %/);
  });

  it("derives the recoverable part from the line's share", () => {
    const plan = planAllocation(
      input({
        targets: [{ target: "unit", unitId: UNIT_A, share: "1" }],
        recoverableShare: "0.75",
      }),
      lines,
    );
    expect(plan.lines[0]?.allocations[0]?.recoverableAmount).toBe("75.00");
  });

  it("refuses a unit allocation without a unit", () => {
    expect(() =>
      planAllocation(input({ targets: [{ target: "unit", share: "1" }] }), lines),
    ).toThrow(/lot/);
  });

  it("refuses a line the expense does not carry", () => {
    const parsed = input({ targets: [{ target: "unit", unitId: UNIT_A, share: "1" }] });
    expect(() =>
      planAllocation(parsed, [{ lineNumber: 2, amountInclTax: "10.00", recoverableShare: "0" }]),
    ).toThrow(/n’existe pas/);
  });
});
