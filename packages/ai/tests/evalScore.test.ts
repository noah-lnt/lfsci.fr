import { describe, expect, it } from "vitest";
import {
  aggregate,
  judgeEvidence,
  markdownTable,
  sameValue,
  scoreDocument,
} from "../src/eval/score";

const SOURCE = "Boulangerie Dupont\n12/09/2026\nTOTAL TTC 2,40 EUR";

function extracted(value: unknown, evidence: Parameters<typeof judgeEvidence>[0]) {
  return { value, evidence };
}

describe("value comparison", () => {
  it("compares amounts as numbers and text without accents or case", () => {
    expect(sameValue("2.40", "2,4")).toBe(true);
    expect(sameValue("2.40", "2.41")).toBe(false);
    expect(sameValue("Boulangerie Dupont", "  BOULANGERIE DUPONT ")).toBe(true);
    expect(sameValue("Café Éole", "cafe eole")).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, "quelque chose")).toBe(false);
  });
});

describe("evidence is scored, never trusted", () => {
  it("calls a bounding box invented when the model never saw a page image", () => {
    expect(
      judgeEvidence({ page: 1, bbox: [0, 0, 10, 10], quote: null }, "2.40", SOURCE, false),
    ).toBe("invented");
  });

  it("cannot confirm a bounding box from a page image, and says so", () => {
    expect(
      judgeEvidence({ page: 1, bbox: [0, 0, 10, 10], quote: null }, "2.40", SOURCE, true),
    ).toBe("unverifiable");
  });

  it("grounds a quote found in the source text and rejects one that is not", () => {
    expect(
      judgeEvidence({ page: 1, bbox: null, quote: "TOTAL TTC 2,40" }, "2.40", SOURCE, false),
    ).toBe("grounded");
    expect(
      judgeEvidence({ page: 1, bbox: null, quote: "REMISE 10 %" }, "2.40", SOURCE, false),
    ).toBe("invented");
  });

  it("rejects evidence attached to an empty value", () => {
    expect(judgeEvidence({ page: 1, bbox: null, quote: "TOTAL TTC" }, null, SOURCE, false)).toBe(
      "invented",
    );
  });

  it("reports no evidence as absent rather than as a failure", () => {
    expect(judgeEvidence(null, "2.40", SOURCE, false)).toBe("absent");
    expect(judgeEvidence({ page: null, bbox: null, quote: null }, "2.40", SOURCE, false)).toBe(
      "absent",
    );
  });
});

describe("document and corpus scores", () => {
  const reference = {
    id: "recu-001",
    fields: { supplier: "Boulangerie Dupont", totalInclTax: "2.40", tax: null },
    sourceText: SOURCE,
    hasPageImages: false,
  };

  it("counts matched values and separates grounded from invented evidence", () => {
    const score = scoreDocument(reference, {
      supplier: extracted("Boulangerie Dupont", {
        page: 1,
        bbox: null,
        quote: "Boulangerie Dupont",
      }),
      totalInclTax: extracted("2,40", { page: 1, bbox: [0, 0, 1, 1], quote: null }),
      tax: extracted(null, null),
    });

    expect(score.matchedFields).toBe(3);
    expect(score.groundedEvidence).toBe(1);
    expect(score.inventedEvidence).toBe(1);
    expect(score.fields.find((field) => field.fieldPath === "tax")?.evidence).toBe("absent");
  });

  it("aggregates accuracy and evidence trust across documents", () => {
    const score = scoreDocument(reference, {
      supplier: extracted("Autre commerce", null),
      totalInclTax: extracted("2.40", { page: 1, bbox: null, quote: "TOTAL TTC 2,40" }),
      tax: extracted(null, null),
    });
    const total = aggregate([score]);

    expect(total.documents).toBe(1);
    expect(total.valueAccuracy).toBeCloseTo(2 / 3);
    expect(total.evidenceTrust).toBe(1);
    expect(markdownTable([score])).toContain("| recu-001 | 2/3 | 1 | 0 |");
  });

  it("returns an accuracy of zero rather than dividing by zero on an empty corpus", () => {
    expect(aggregate([])).toMatchObject({ documents: 0, valueAccuracy: 0, evidenceTrust: 1 });
  });
});
