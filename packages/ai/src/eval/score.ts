import type { Evidence } from "../schemas/field";

/**
 * A first pass on a small model returned correct values with invented
 * `evidence.bbox` coordinates on text-only input (docs/QUESTIONS.md item 5c).
 * Evidence is therefore scored, never trusted: a quote must be found in the
 * source text, and a bounding box can only come from a page image.
 */
export type EvidenceVerdict = "absent" | "grounded" | "invented" | "unverifiable";

export type FieldScore = {
  fieldPath: string;
  expected: string | null;
  actual: string | null;
  valueMatch: boolean;
  evidence: EvidenceVerdict;
};

export type ExtractedField = { value: unknown; evidence: Evidence | null };

export type ReferenceCase = {
  id: string;
  /** Expected value per field path; `null` means the field must come back empty. */
  fields: Record<string, string | null>;
  sourceText: string;
  /** Whether the run sent page images; without them a bounding box cannot be observed. */
  hasPageImages: boolean;
};

export type DocumentScore = {
  id: string;
  fields: FieldScore[];
  expectedFields: number;
  matchedFields: number;
  groundedEvidence: number;
  inventedEvidence: number;
};

export type CorpusScore = {
  documents: number;
  expectedFields: number;
  matchedFields: number;
  valueAccuracy: number;
  groundedEvidence: number;
  inventedEvidence: number;
  /** Share of the evidence blocks the source text confirms; 1 when none was offered. */
  evidenceTrust: number;
};

export function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ");
  return String(value);
}

/** Amounts compare as numbers so `2.40` and `2,4` are the same value. */
export function sameValue(expected: string | null, actual: string | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  const expectedNumber = Number(expected.replace(",", "."));
  const actualNumber = Number(actual.replace(",", "."));
  if (Number.isFinite(expectedNumber) && Number.isFinite(actualNumber)) {
    return Math.abs(expectedNumber - actualNumber) < 0.005;
  }
  return normalize(expected) === normalize(actual);
}

export function judgeEvidence(
  evidence: Evidence | null,
  value: string | null,
  sourceText: string,
  hasPageImages: boolean,
): EvidenceVerdict {
  if (!evidence || (evidence.quote === null && evidence.bbox === null && evidence.page === null)) {
    return "absent";
  }
  if (value === null) return "invented";
  if (evidence.bbox !== null && !hasPageImages) return "invented";
  if (evidence.quote !== null) {
    return normalize(sourceText).includes(normalize(evidence.quote)) ? "grounded" : "invented";
  }
  return hasPageImages ? "unverifiable" : "invented";
}

export function scoreDocument(
  reference: ReferenceCase,
  extracted: Record<string, ExtractedField>,
): DocumentScore {
  const fields: FieldScore[] = [];
  for (const [fieldPath, expected] of Object.entries(reference.fields)) {
    const found = extracted[fieldPath];
    const actual = found ? asString(found.value) : null;
    fields.push({
      fieldPath,
      expected,
      actual,
      valueMatch: sameValue(expected, actual),
      evidence: judgeEvidence(
        found?.evidence ?? null,
        actual,
        reference.sourceText,
        reference.hasPageImages,
      ),
    });
  }

  return {
    id: reference.id,
    fields,
    expectedFields: fields.length,
    matchedFields: fields.filter((field) => field.valueMatch).length,
    groundedEvidence: fields.filter((field) => field.evidence === "grounded").length,
    inventedEvidence: fields.filter((field) => field.evidence === "invented").length,
  };
}

export function aggregate(scores: DocumentScore[]): CorpusScore {
  const expectedFields = scores.reduce((total, score) => total + score.expectedFields, 0);
  const matchedFields = scores.reduce((total, score) => total + score.matchedFields, 0);
  const grounded = scores.reduce((total, score) => total + score.groundedEvidence, 0);
  const invented = scores.reduce((total, score) => total + score.inventedEvidence, 0);
  const offered = grounded + invented;
  return {
    documents: scores.length,
    expectedFields,
    matchedFields,
    valueAccuracy: expectedFields === 0 ? 0 : matchedFields / expectedFields,
    groundedEvidence: grounded,
    inventedEvidence: invented,
    evidenceTrust: offered === 0 ? 1 : grounded / offered,
  };
}

/** One row per document, ready for the table in `docs/ai-eval.md`. */
export function markdownTable(scores: DocumentScore[]): string {
  const header = "| Document | Champs justes | Preuves fondées | Preuves inventées |";
  const rule = "|---|---|---|---|";
  const rows = scores.map(
    (score) =>
      `| ${score.id} | ${score.matchedFields}/${score.expectedFields} | ${score.groundedEvidence} | ${score.inventedEvidence} |`,
  );
  return [header, rule, ...rows].join("\n");
}
