import { describe, expect, it } from "vitest";
import {
  type AllocationConfirmation,
  type AllocationEffect,
  detectRuleProposals,
  effectSignature,
  proposalCode,
} from "../src/rule-proposals";

const EFFECT_ORIGIN = { kind: "supplier" as const, key: "s-1", label: "Nettoyage Pyrénées" };

const EFFECT: AllocationEffect = {
  target: "building_common",
  targetId: "b-1",
  targetLabel: "Résidence des Lilas",
  category: "cleaning",
  recoverable: true,
  accountHint: "615200",
};

function confirmation(
  id: string,
  confirmedOn: string,
  effect: Partial<AllocationEffect> = {},
  origin = EFFECT_ORIGIN,
): AllocationConfirmation {
  return {
    id,
    origin,
    effect: { ...EFFECT, ...effect },
    confirmedOn,
    evidenceLabel: `Facture ${id}`,
  };
}

describe("effect signature", () => {
  it("separates two effects that differ on any single field", () => {
    const base = effectSignature(EFFECT);
    expect(effectSignature({ ...EFFECT, recoverable: false })).not.toBe(base);
    expect(effectSignature({ ...EFFECT, category: "repairs" })).not.toBe(base);
    expect(effectSignature({ ...EFFECT, targetId: "b-2" })).not.toBe(base);
    expect(effectSignature({ ...EFFECT, target: "entity_common" })).not.toBe(base);
    expect(effectSignature({ ...EFFECT, accountHint: "606100" })).not.toBe(base);
  });

  it("ignores the human label, which is not part of the effect", () => {
    expect(effectSignature({ ...EFFECT, targetLabel: "autre libellé" })).toBe(
      effectSignature(EFFECT),
    );
  });
});

describe("detecting a repeated pattern", () => {
  it("proposes a rule once the same effect is confirmed enough times", () => {
    const proposals = detectRuleProposals([
      confirmation("1", "2026-03-10"),
      confirmation("2", "2026-04-12"),
      confirmation("3", "2026-05-14"),
    ]);

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal?.confirmationCount).toBe(3);
    expect(proposal?.firstConfirmedOn).toBe("2026-03-10");
    expect(proposal?.lastConfirmedOn).toBe("2026-05-14");
    expect(proposal?.origin.label).toBe("Nettoyage Pyrénées");
    expect(proposal?.effect.targetLabel).toBe("Résidence des Lilas");
    expect(proposal?.code).toBe(proposalCode(EFFECT_ORIGIN, EFFECT));
  });

  it("stays silent below the threshold", () => {
    expect(
      detectRuleProposals([confirmation("1", "2026-03-10"), confirmation("2", "2026-04-12")]),
    ).toEqual([]);
  });

  it("does NOT propose when one confirmation differs on a single field", () => {
    const proposals = detectRuleProposals([
      confirmation("1", "2026-03-10"),
      confirmation("2", "2026-04-12"),
      confirmation("3", "2026-05-14", { recoverable: false }),
    ]);
    expect(proposals).toEqual([]);
  });

  it("does not propose either when the majority alone would reach the threshold", () => {
    const proposals = detectRuleProposals([
      confirmation("1", "2026-03-10"),
      confirmation("2", "2026-04-12"),
      confirmation("3", "2026-05-14"),
      confirmation("4", "2026-06-15", { targetId: "b-2" }),
    ]);
    expect(proposals).toEqual([]);
  });

  it("keeps two origins independent", () => {
    const other = { kind: "supplier" as const, key: "s-2", label: "Chauffage du Béarn" };
    const proposals = detectRuleProposals([
      confirmation("1", "2026-03-10"),
      confirmation("2", "2026-04-12"),
      confirmation("3", "2026-05-14"),
      confirmation("4", "2026-03-11", { category: "heating" }, other),
      confirmation("5", "2026-04-13", { category: "heating" }, other),
      confirmation("6", "2026-05-15", { category: "heating" }, other),
      confirmation("7", "2026-06-16", { category: "heating" }, other),
    ]);
    expect(proposals.map((proposal) => proposal.origin.key)).toEqual(["s-2", "s-1"]);
    expect(proposals[0]?.confirmationCount).toBe(4);
  });

  it("carries the most recent confirmations as evidence, newest first", () => {
    const proposals = detectRuleProposals(
      [
        confirmation("1", "2026-03-10"),
        confirmation("2", "2026-04-12"),
        confirmation("3", "2026-05-14"),
        confirmation("4", "2026-06-15"),
      ],
      { maxExamples: 2 },
    );
    expect(proposals[0]?.examples.map((example) => example.id)).toEqual(["4", "3"]);
    expect(proposals[0]?.examples[0]?.label).toBe("Facture 4");
  });

  it("honours a threshold raised by the caller", () => {
    const three = [
      confirmation("1", "2026-03-10"),
      confirmation("2", "2026-04-12"),
      confirmation("3", "2026-05-14"),
    ];
    expect(detectRuleProposals(three, { minConfirmations: 4 })).toEqual([]);
    expect(detectRuleProposals(three, { minConfirmations: 3 })).toHaveLength(1);
  });

  it("proposes nothing on an empty history", () => {
    expect(detectRuleProposals([])).toEqual([]);
  });
});
