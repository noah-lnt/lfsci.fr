export type SearchMatchKind = "words" | "meaning" | "both";

export type SearchSignal = {
  id: string;
  /** `ts_rank_cd` against the query; 0 when the row was reached by the vector half alone. */
  textRank: number;
  /** pgvector cosine distance, 0 (identical) to 2 (opposite). Null when the row has no embedding yet. */
  vectorDistance: number | null;
};

export type RankedSearchHit = {
  id: string;
  score: number;
  textScore: number;
  vectorScore: number | null;
  matchedOn: SearchMatchKind;
};

export const TEXT_WEIGHT = 0.6;
export const VECTOR_WEIGHT = 0.4;

/** Below this cosine similarity a neighbour is noise rather than a match on meaning. */
export const MEANING_THRESHOLD = 0.35;

/**
 * `ts_rank_cd` has no upper bound and no scale of its own. Normalising against the
 * best row of the same answer would hand a lone weak match a perfect score, so the
 * rank is saturated against this constant instead: weak stays weak whatever else
 * the answer contains.
 */
export const TEXT_SATURATION = 0.1;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function textScoreOf(textRank: number): number {
  if (!Number.isFinite(textRank) || textRank <= 0) return 0;
  return round(textRank / (textRank + TEXT_SATURATION));
}

/** Cosine distance in [0, 2] read as a similarity in [0, 1]. */
export function similarityOf(vectorDistance: number | null): number | null {
  if (vectorDistance === null) return null;
  return clamp01(1 - vectorDistance);
}

/**
 * The embedding backlog is ours, not the row's: a row the provider has not reached
 * yet keeps the whole score for the half that exists, so it ranks against embedded
 * rows on equal terms instead of being buried by a missing vector.
 */
export function combineScores(textScore: number, vectorScore: number | null): number {
  if (vectorScore === null) return round(clamp01(textScore));
  return round(TEXT_WEIGHT * clamp01(textScore) + VECTOR_WEIGHT * vectorScore);
}

export function matchKindOf(textRank: number, vectorScore: number | null): SearchMatchKind {
  const onWords = textRank > 0;
  const onMeaning = vectorScore !== null && vectorScore >= MEANING_THRESHOLD;
  if (onWords && onMeaning) return "both";
  if (onMeaning) return "meaning";
  return "words";
}

export function rankSearchHits(signals: readonly SearchSignal[]): RankedSearchHit[] {
  return signals
    .map((signal) => {
      const textScore = textScoreOf(signal.textRank);
      const vectorScore = similarityOf(signal.vectorDistance);
      return {
        id: signal.id,
        score: combineScores(textScore, vectorScore),
        textScore,
        vectorScore: vectorScore === null ? null : round(vectorScore),
        matchedOn: matchKindOf(signal.textRank, vectorScore),
      };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
