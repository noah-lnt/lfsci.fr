import { describe, expect, it } from "vitest";
import { proposeRevision, type RevisionInput } from "../src/irl";

const base: RevisionInput = {
  currentRent: "1000.00",
  baseIndex: { value: "100.00", quarter: 2, year: 2025 },
  newIndex: { value: "103.50", quarter: 2, year: 2026 },
  clausePresent: true,
  dpeClass: "D",
  territory: "metropole",
  requestDate: "2026-09-20",
  revisionDueDate: "2026-09-01",
};

describe("IRL-01 — revision proposal", () => {
  it("applies rent × new / old rounded to the cent", () => {
    const result = proposeRevision(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newRent).toBe("1035.00");
    expect(result.increase).toBe("35.00");
    expect(result.retroactive).toBe(false);
    expect(result.effectiveFrom).toBe("2026-09-20");
  });

  it("rounds half up", () => {
    const result = proposeRevision({
      ...base,
      currentRent: "100.00",
      baseIndex: { value: "8.00", quarter: 2, year: 2025 },
      newIndex: { value: "8.01", quarter: 2, year: 2026 },
    });
    expect(result.ok && result.newRent).toBe("100.13");
  });

  it("blocks without an indexation clause", () => {
    expect(proposeRevision({ ...base, clausePresent: false })).toEqual({
      ok: false,
      reason: "missing_clause",
      missing: ["clause"],
    });
  });

  it("blocks on a missing index", () => {
    const result = proposeRevision({ ...base, newIndex: undefined });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("missing_index");
    expect(result.ok === false && result.missing).toEqual(["newIndex"]);
  });

  it("blocks when the reference quarters differ", () => {
    const result = proposeRevision({
      ...base,
      newIndex: { value: "103.50", quarter: 3, year: 2026 },
    });
    expect(result.ok === false && result.reason).toBe("quarter_mismatch");
  });

  it("blocks an F or G rating in métropole and allows it outre-mer", () => {
    expect(proposeRevision({ ...base, dpeClass: "F" }).ok).toBe(false);
    expect(proposeRevision({ ...base, dpeClass: "G" })).toMatchObject({ reason: "dpe_frozen" });
    expect(proposeRevision({ ...base, dpeClass: "F", territory: "outre_mer" }).ok).toBe(true);
    expect(proposeRevision({ ...base, dpeClass: "E" }).ok).toBe(true);
  });

  it("never applies before the revision is due", () => {
    const result = proposeRevision({ ...base, requestDate: "2026-08-31" });
    expect(result.ok === false && result.reason).toBe("not_due_yet");
  });

  it("never backdates the effect to the anniversary", () => {
    const result = proposeRevision({ ...base, requestDate: "2026-11-30" });
    expect(result.ok && result.effectiveFrom).toBe("2026-11-30");
  });
});
