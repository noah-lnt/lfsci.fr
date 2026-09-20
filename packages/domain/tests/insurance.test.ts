import { describe, expect, it } from "vitest";
import {
  certificateDueOn,
  certificateState,
  claimBalance,
  isCertificateException,
  matchAttestation,
  type PolicyCandidate,
} from "../src/insurance";

const TODAY = "2026-09-20";

describe("ASS-01 — certificate state", () => {
  it("reads a policy with no certificate as missing, whatever its cover", () => {
    expect(
      certificateState({ hasCertificate: false, coverEndsOn: "2027-12-31", today: TODAY }),
    ).toBe("missing");
  });

  it("reads a lapsed cover as expired, not as expiring", () => {
    expect(
      certificateState({ hasCertificate: true, coverEndsOn: "2026-09-19", today: TODAY }),
    ).toBe("expired");
  });

  it("warns inside the notice window and stays valid outside it", () => {
    expect(
      certificateState({ hasCertificate: true, coverEndsOn: "2026-10-20", today: TODAY }),
    ).toBe("expiring");
    expect(
      certificateState({ hasCertificate: true, coverEndsOn: "2026-10-21", today: TODAY }),
    ).toBe("valid");
  });

  it("treats a certificate with no end date as valid", () => {
    expect(certificateState({ hasCertificate: true, coverEndsOn: null, today: TODAY })).toBe(
      "valid",
    );
  });

  it("counts missing and expired as exceptions, expiring as a warning", () => {
    expect(isCertificateException("missing")).toBe(true);
    expect(isCertificateException("expired")).toBe(true);
    expect(isCertificateException("expiring")).toBe(false);
    expect(isCertificateException("valid")).toBe(false);
  });

  it("places the renewal a notice window before the end, never in the past", () => {
    expect(certificateDueOn("2026-12-31", TODAY)).toBe("2026-12-01");
    expect(certificateDueOn("2026-09-25", TODAY)).toBe(TODAY);
  });
});

describe("SIN-01 — claim balance without netting", () => {
  const base = {
    expenses: [
      { id: "exp-1", amount: "4200.00" },
      { id: "exp-2", amount: "800.50" },
    ],
    indemnities: [
      { id: "ind-1", amount: "2000.00", kind: "advance" },
      { id: "ind-2", amount: "1500.00", kind: "final" },
    ],
    deductibleApplied: "380.00",
    indemnityExpected: "4200.00",
  };

  it("keeps both gross totals and derives what stays on the owner", () => {
    const balance = claimBalance(base);
    expect(balance.grossCost).toBe("5000.50");
    expect(balance.grossIndemnities).toBe("3500.00");
    expect(balance.remainingCost).toBe("1500.50");
    expect(balance.expenseCount).toBe(2);
    expect(balance.indemnityCount).toBe(2);
  });

  it("reports the deductible apart instead of subtracting it from the cash received", () => {
    const balance = claimBalance({
      ...base,
      indemnities: [...base.indemnities, { id: "ind-3", amount: "380.00", kind: "deductible" }],
    });
    expect(balance.grossIndemnities).toBe("3500.00");
    expect(balance.deductible).toBe("760.00");
  });

  it("says what is still expected from the insurer", () => {
    expect(claimBalance(base).stillExpected).toBe("700.00");
    expect(claimBalance({ ...base, indemnityExpected: null }).stillExpected).toBeNull();
  });

  it("shows a claim with no indemnity yet as fully on the owner", () => {
    const balance = claimBalance({ ...base, indemnities: [] });
    expect(balance.grossIndemnities).toBe("0.00");
    expect(balance.remainingCost).toBe("5000.50");
  });

  it("does not turn an over-indemnified claim into a hidden zero", () => {
    const balance = claimBalance({
      ...base,
      indemnities: [{ id: "ind-4", amount: "6000.00", kind: "final" }],
    });
    expect(balance.grossCost).toBe("5000.50");
    expect(balance.remainingCost).toBe("-999.50");
  });
});

describe("ASS-01 — attestation matching", () => {
  const policies: PolicyCandidate[] = [
    {
      id: "pol-1",
      insurerName: "Assurances Générales du Sud",
      policyNumber: "PNO-2026-0041",
      insuredName: "SCI de démonstration",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    },
    {
      id: "pol-2",
      insurerName: "Mutuelle de l’Ouest",
      policyNumber: "MRH-77-2",
      insuredName: "SCI de démonstration",
      startsOn: "2025-06-01",
      endsOn: "2026-05-31",
    },
  ];

  const attestation = {
    insurer: "ASSURANCES GENERALES DU SUD",
    policyNumber: "pno 2026 0041",
    insuredName: "SCI de démonstration",
    validFrom: "2026-02-01",
    validTo: "2027-01-31",
  };

  it("ranks the policy whose number matches first and says what it matched on", () => {
    const [best] = matchAttestation(attestation, policies);
    expect(best?.policyId).toBe("pol-1");
    expect(best?.matchedOn).toEqual(["policy_number", "insurer", "insured_name", "period"]);
    expect(best?.confident).toBe(true);
  });

  it("ignores punctuation, case and accents in the number and the insurer", () => {
    const [best] = matchAttestation(
      { ...attestation, insurer: "assurances générales du sud" },
      policies,
    );
    expect(best?.matchedOn).toContain("insurer");
  });

  it("keeps a weak candidate but refuses to call it confident", () => {
    const matches = matchAttestation({ ...attestation, policyNumber: "INCONNU-1" }, [
      policies[1] as PolicyCandidate,
    ]);
    expect(matches[0]?.policyId).toBe("pol-2");
    expect(matches[0]?.confident).toBe(false);
    expect(matches[0]?.conflicts).toContain("policy_number");
  });

  it("flags a date outside the cover as a conflict rather than dropping the policy", () => {
    const matches = matchAttestation({ ...attestation, validFrom: "2026-08-01" }, [
      policies[1] as PolicyCandidate,
    ]);
    expect(matches[0]?.conflicts).toContain("period");
    expect(matches[0]?.matchedOn).not.toContain("period");
  });

  it("returns nothing when no signal matches at all", () => {
    expect(
      matchAttestation(
        {
          insurer: "Autre Assureur",
          policyNumber: "ZZZ",
          insuredName: "Quelqu’un d’autre",
          validFrom: "2030-01-01",
          validTo: "2031-01-01",
        },
        policies,
      ),
    ).toEqual([]);
  });
});
