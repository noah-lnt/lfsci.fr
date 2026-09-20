import "server-only";
import type { InspectionFindingCondition, InventoryItemCondition } from "@lfsci/contracts";
import { type DepositSettlement, settleDeposit } from "@lfsci/domain";
import type {
  FindingDifference,
  InventoryDifference,
  SettlementBlockedReason,
} from "@/lib/contracts/inspections";

/** `not_checked` has no rank on purpose: nothing was observed. */
const SEVERITY: Partial<Record<InspectionFindingCondition, number>> = {
  new: 0,
  good: 1,
  fair: 2,
  worn: 3,
  damaged: 4,
  missing: 5,
};

/** At and above `worn` the observation is a defect worth the owner's review. */
const DEFECT_FROM = 3;

export type FindingLike = {
  id: string;
  room: string | null;
  element: string;
  condition: InspectionFindingCondition | null;
  description: string | null;
};

export type InventoryLike = {
  id: string;
  label: string;
  category: string;
  quantity: string;
  condition: InventoryItemCondition | null;
  presentAtEntry: boolean | null;
  presentAtExit: boolean | null;
};

function severityOf(condition: InspectionFindingCondition | null): number | null {
  return condition === null ? null : (SEVERITY[condition] ?? null);
}

/** Rooms and elements are typed twice, months apart: match on a folded form. */
function matchKey(finding: FindingLike): string {
  const fold = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return `${fold(finding.room ?? "")}|${fold(finding.element)}`;
}

/**
 * EDL-03: the exit is read against the entry and the differences are prepared.
 * Only a new defect or a degraded one is proposed for review, and nothing here
 * decides responsibility, wear or an amount.
 */
export function compareFindings(
  entry: readonly FindingLike[],
  exit: readonly FindingLike[],
): FindingDifference[] {
  const entryByKey = new Map(entry.map((finding) => [matchKey(finding), finding]));
  const seen = new Set<string>();
  const differences: FindingDifference[] = [];

  for (const exitFinding of exit) {
    const key = matchKey(exitFinding);
    const entryFinding = entryByKey.get(key);
    if (entryFinding) seen.add(key);
    const exitSeverity = severityOf(exitFinding.condition);
    const entrySeverity = entryFinding ? severityOf(entryFinding.condition) : null;

    let status: FindingDifference["status"];
    if (!entryFinding) {
      status = exitSeverity === null ? "undetermined" : "new";
    } else if (exitSeverity === null || entrySeverity === null) {
      status = "undetermined";
    } else if (exitSeverity > entrySeverity) {
      status = "degraded";
    } else if (exitSeverity < entrySeverity) {
      status = "improved";
    } else {
      status = "unchanged";
    }

    differences.push({
      room: exitFinding.room,
      element: exitFinding.element,
      entryFindingId: entryFinding?.id ?? null,
      entryCondition: entryFinding?.condition ?? null,
      exitFindingId: exitFinding.id,
      exitCondition: exitFinding.condition,
      description: exitFinding.description,
      status,
      proposedForReview:
        (status === "new" || status === "degraded") &&
        exitSeverity !== null &&
        exitSeverity >= DEFECT_FROM,
    });
  }

  for (const entryFinding of entry) {
    const key = matchKey(entryFinding);
    if (seen.has(key)) continue;
    differences.push({
      room: entryFinding.room,
      element: entryFinding.element,
      entryFindingId: entryFinding.id,
      entryCondition: entryFinding.condition,
      exitFindingId: null,
      exitCondition: null,
      description: entryFinding.description,
      status: "not_observed",
      proposedForReview: false,
    });
  }

  return differences;
}

/**
 * EDL-02: an item present at entry and absent at exit is reported for a
 * decision. It never becomes a retention on its own — no amount is derived
 * here, and the settlement below only reads amounts the owner decided.
 */
export function compareInventory(items: readonly InventoryLike[]): InventoryDifference[] {
  return items.map((item) => {
    let status: InventoryDifference["status"];
    if (item.presentAtEntry === null || item.presentAtExit === null) {
      status = "undetermined";
    } else if (item.presentAtEntry && !item.presentAtExit) {
      status = "missing";
    } else if (!item.presentAtEntry && item.presentAtExit) {
      status = "added";
    } else if (item.presentAtEntry) {
      status = "present";
    } else {
      status = "absent";
    }
    return {
      id: item.id,
      label: item.label,
      category: item.category,
      quantity: item.quantity,
      condition: item.condition,
      presentAtEntry: item.presentAtEntry,
      presentAtExit: item.presentAtExit,
      status,
      requiresDecision: status === "missing",
    };
  });
}

/** EDL-03: one month when the exit matches the entry, two when it does not. */
export function exitConforms(
  differences: readonly FindingDifference[],
  inventory: readonly InventoryDifference[],
): boolean {
  return (
    differences.every((difference) => !difference.proposedForReview) &&
    inventory.every((item) => item.status !== "missing")
  );
}

export type SettlementCandidate = {
  findingId: string;
  amount: string;
  justificationIds: string[];
};

type Prepared =
  | { settlement: Extract<DepositSettlement, { ok: true }>; blockedReason: null }
  | { settlement: null; blockedReason: SettlementBlockedReason };

export function prepareSettlement(input: {
  depositHeld: string;
  keyHandoverDate: string | null;
  conforms: boolean;
  candidates: readonly SettlementCandidate[];
}): Prepared {
  if (input.keyHandoverDate === null) {
    return { settlement: null, blockedReason: "keys_not_handed_over" };
  }
  const result = settleDeposit({
    depositHeld: input.depositHeld,
    deductions: input.candidates.map((candidate) => ({
      id: candidate.findingId,
      amount: candidate.amount,
      justificationIds: candidate.justificationIds,
    })),
    exitInspectionConforms: input.conforms,
    keyHandoverDate: input.keyHandoverDate,
  });
  return result.ok
    ? { settlement: result, blockedReason: null }
    : { settlement: null, blockedReason: result.reason };
}
