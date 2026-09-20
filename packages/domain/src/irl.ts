import { money, roundCent, toMoney } from "./money";
import type { IsoDateString } from "./periods";
import { type Blocked, blocked } from "./result";

export type Quarter = 1 | 2 | 3 | 4;
export type DpeClass = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type Territory = "metropole" | "outre_mer";

export type IndexValue = { value: string; quarter: Quarter; year: number };

export type RevisionInput = {
  currentRent: string;
  baseIndex?: IndexValue | undefined;
  newIndex?: IndexValue | undefined;
  clausePresent: boolean;
  dpeClass?: DpeClass | undefined;
  territory: Territory;
  requestDate: IsoDateString;
  revisionDueDate: IsoDateString;
};

export type RevisionBlockedReason =
  | "missing_clause"
  | "missing_index"
  | "quarter_mismatch"
  | "dpe_frozen"
  | "not_due_yet";

export type RevisionProposal =
  | {
      ok: true;
      currentRent: string;
      newRent: string;
      increase: string;
      baseIndex: IndexValue;
      newIndex: IndexValue;
      effectiveFrom: IsoDateString;
      retroactive: false;
    }
  | Blocked<RevisionBlockedReason>;

// Loyers gelés pour les passoires thermiques F/G (métropole). Les dates
// d'entrée en vigueur outre-mer diffèrent : à confirmer avant usage réel.
const FROZEN_CLASSES: ReadonlySet<DpeClass> = new Set<DpeClass>(["F", "G"]);

export function proposeRevision(input: RevisionInput): RevisionProposal {
  if (!input.clausePresent) return blocked("missing_clause", ["clause"]);

  const missingIndexes: string[] = [];
  if (input.baseIndex === undefined) missingIndexes.push("baseIndex");
  if (input.newIndex === undefined) missingIndexes.push("newIndex");
  if (input.baseIndex === undefined || input.newIndex === undefined) {
    return blocked("missing_index", missingIndexes);
  }

  if (input.baseIndex.quarter !== input.newIndex.quarter) {
    return blocked("quarter_mismatch", ["baseIndex.quarter", "newIndex.quarter"]);
  }

  if (input.dpeClass === undefined) return blocked("missing_index", ["dpeClass"]);
  if (input.territory === "metropole" && FROZEN_CLASSES.has(input.dpeClass)) {
    return blocked("dpe_frozen", ["dpeClass"]);
  }

  if (input.requestDate < input.revisionDueDate) return blocked("not_due_yet", ["revisionDueDate"]);

  const current = money(input.currentRent);
  const base = money(input.baseIndex.value);
  const next = money(input.newIndex.value);
  if (base.isZero()) return blocked("missing_index", ["baseIndex.value"]);

  const revised = roundCent(current.times(next).dividedBy(base));
  return {
    ok: true,
    currentRent: toMoney(current),
    newRent: toMoney(revised),
    increase: toMoney(revised.minus(current)),
    baseIndex: input.baseIndex,
    newIndex: input.newIndex,
    effectiveFrom: input.requestDate,
    retroactive: false,
  };
}
