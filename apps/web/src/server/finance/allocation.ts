import "server-only";
import { allocateExpense, decimal, recoverableSplit, sum, toMoney } from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";
import { type AllocateExpenseInput, UNALLOCATED_TARGET } from "@/lib/contracts/finance";

export type PlannedAllocation = {
  target: "unit" | "building_common" | "entity_common";
  unitId: string | null;
  buildingId: string | null;
  legalEntityId: string | null;
  amount: string;
  recoverableAmount: string;
};

export type PlannedLine = {
  lineNumber: number;
  amountInclTax: string;
  recoverableShare: string;
  unallocatedAmount: string;
  allocations: PlannedAllocation[];
};

export type AllocationPlan = {
  lines: PlannedLine[];
  totalAllocated: string;
  totalUnallocated: string;
};

type LineAmounts = { lineNumber: number; amountInclTax: string; recoverableShare: string };

function targetKey(index: number): string {
  return `t${index}`;
}

function requireTargetColumns(
  entry: AllocateExpenseInput["lines"][number]["targets"][number],
): Pick<PlannedAllocation, "unitId" | "buildingId" | "legalEntityId"> {
  if (entry.target === "unit") {
    if (!entry.unitId) throw refusal("Une affectation sur un lot exige le lot.");
    return { unitId: entry.unitId, buildingId: null, legalEntityId: null };
  }
  if (entry.target === "building_common") {
    if (!entry.buildingId) throw refusal("Une part commune exige l’immeuble.");
    return { unitId: null, buildingId: entry.buildingId, legalEntityId: null };
  }
  if (!entry.legalEntityId) throw refusal("Une affectation à la SCI exige la SCI.");
  return { unitId: null, buildingId: null, legalEntityId: entry.legalEntityId };
}

function refusal(message: string): AppError {
  return new AppError("RULE_VIOLATION", { message });
}

/**
 * CHA-01 / F05: one pass per line, shares split by the domain's largest-remainder
 * rule so allocations plus the explicit residual equal the line to the cent.
 * The residual rides in the same split, which is what makes the sum exact.
 */
export function planAllocation(
  input: AllocateExpenseInput,
  lines: readonly LineAmounts[],
): AllocationPlan {
  const byNumber = new Map(lines.map((line) => [line.lineNumber, line]));
  const planned: PlannedLine[] = [];

  for (const requested of input.lines) {
    const line = byNumber.get(requested.lineNumber);
    if (!line) {
      throw refusal(`La ligne ${requested.lineNumber} n’existe pas sur cette dépense.`);
    }
    const recoverableShare = requested.recoverableShare ?? line.recoverableShare;
    const unallocatedShare = requested.unallocatedShare ?? "0";
    const shares = [
      ...requested.targets.map((entry, index) => ({
        lotId: targetKey(index),
        share: entry.share,
      })),
      ...(decimal(unallocatedShare).isZero()
        ? []
        : [{ lotId: UNALLOCATED_TARGET, share: unallocatedShare }]),
    ];

    const split = allocateExpense({ amount: line.amountInclTax, key: { version: 1, shares } });
    if (!split.ok) {
      throw refusal(
        `Ligne ${requested.lineNumber} : les parts doivent totaliser exactement 100 %.`,
      );
    }

    const amountByKey = new Map(split.lots.map((lot) => [lot.lotId, lot.amount]));
    const allocations = requested.targets.map((entry, index) => {
      const allocated = amountByKey.get(targetKey(index)) ?? "0.00";
      return {
        target: entry.target,
        ...requireTargetColumns(entry),
        amount: allocated,
        recoverableAmount: recoverableSplit({
          amount: allocated,
          recoverableRate: recoverableShare,
        }).recoverable,
      };
    });

    planned.push({
      lineNumber: requested.lineNumber,
      amountInclTax: line.amountInclTax,
      recoverableShare,
      unallocatedAmount: amountByKey.get(UNALLOCATED_TARGET) ?? "0.00",
      allocations,
    });
  }

  return {
    lines: planned,
    totalAllocated: toMoney(
      sum(planned.flatMap((line) => line.allocations.map((a) => decimal(a.amount)))),
    ),
    totalUnallocated: toMoney(sum(planned.map((line) => decimal(line.unallocatedAmount)))),
  };
}
