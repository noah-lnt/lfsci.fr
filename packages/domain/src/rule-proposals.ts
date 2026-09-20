export type RuleOriginKind = "supplier" | "meter" | "bank_label";

export type RuleOrigin = {
  kind: RuleOriginKind;
  key: string;
  label: string;
};

export type AllocationTarget = "unit" | "building_common" | "entity_common";

/** IA-06: the effect a rule would reproduce — where, which category, recoverable, how booked. */
export type AllocationEffect = {
  target: AllocationTarget;
  targetId: string | null;
  targetLabel: string;
  category: string | null;
  recoverable: boolean;
  accountHint: string | null;
};

export type AllocationConfirmation = {
  id: string;
  origin: RuleOrigin;
  effect: AllocationEffect;
  /** `YYYY-MM-DD`. */
  confirmedOn: string;
  evidenceLabel: string;
};

export type RuleProposalExample = {
  id: string;
  label: string;
  confirmedOn: string;
};

export type RuleProposal = {
  code: string;
  origin: RuleOrigin;
  effect: AllocationEffect;
  confirmationCount: number;
  firstConfirmedOn: string;
  lastConfirmedOn: string;
  examples: RuleProposalExample[];
};

export const MIN_CONFIRMATIONS = 3;
export const MAX_EXAMPLES = 3;

export type DetectRuleProposalsOptions = {
  minConfirmations?: number;
  maxExamples?: number;
};

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Two confirmations belong to the same pattern only if every field of the effect matches. */
export function effectSignature(effect: AllocationEffect): string {
  return [
    effect.target,
    effect.targetId ?? "",
    effect.category ?? "",
    effect.recoverable ? "recoverable" : "non_recoverable",
    effect.accountHint ?? "",
  ].join("|");
}

export function proposalCode(origin: RuleOrigin, effect: AllocationEffect): string {
  return `pattern:${origin.kind}:${origin.key}:${fnv1a(effectSignature(effect))}`;
}

/**
 * A pattern is proposed only when one origin always led to the same effect: an origin
 * whose confirmations disagree is a judgement call the owner keeps making, not a rule.
 */
export function detectRuleProposals(
  confirmations: readonly AllocationConfirmation[],
  options: DetectRuleProposalsOptions = {},
): RuleProposal[] {
  const minConfirmations = options.minConfirmations ?? MIN_CONFIRMATIONS;
  const maxExamples = options.maxExamples ?? MAX_EXAMPLES;

  const byOrigin = new Map<string, AllocationConfirmation[]>();
  for (const confirmation of confirmations) {
    const key = `${confirmation.origin.kind}:${confirmation.origin.key}`;
    const bucket = byOrigin.get(key);
    if (bucket) bucket.push(confirmation);
    else byOrigin.set(key, [confirmation]);
  }

  const proposals: RuleProposal[] = [];
  for (const bucket of byOrigin.values()) {
    const signatures = new Set(bucket.map((entry) => effectSignature(entry.effect)));
    if (signatures.size !== 1) continue;
    if (bucket.length < minConfirmations) continue;

    const sorted = [...bucket].sort(
      (left, right) =>
        left.confirmedOn.localeCompare(right.confirmedOn) || left.id.localeCompare(right.id),
    );
    const first = sorted[0] as AllocationConfirmation;
    const last = sorted[sorted.length - 1] as AllocationConfirmation;
    proposals.push({
      code: proposalCode(first.origin, first.effect),
      origin: first.origin,
      effect: first.effect,
      confirmationCount: sorted.length,
      firstConfirmedOn: first.confirmedOn,
      lastConfirmedOn: last.confirmedOn,
      examples: sorted
        .slice(-maxExamples)
        .reverse()
        .map((entry) => ({
          id: entry.id,
          label: entry.evidenceLabel,
          confirmedOn: entry.confirmedOn,
        })),
    });
  }

  return proposals.sort(
    (left, right) =>
      right.confirmationCount - left.confirmationCount || left.code.localeCompare(right.code),
  );
}
