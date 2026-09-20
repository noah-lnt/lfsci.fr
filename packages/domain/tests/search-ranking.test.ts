import { describe, expect, it } from "vitest";
import {
  combineScores,
  MEANING_THRESHOLD,
  matchKindOf,
  rankSearchHits,
  similarityOf,
  TEXT_SATURATION,
  TEXT_WEIGHT,
  textScoreOf,
  VECTOR_WEIGHT,
} from "../src/search-ranking";

describe("cosine distance read as a similarity", () => {
  it("maps identical, orthogonal and opposite vectors", () => {
    expect(similarityOf(0)).toBe(1);
    expect(similarityOf(1)).toBe(0);
    expect(similarityOf(2)).toBe(0);
    expect(similarityOf(null)).toBeNull();
  });
});

describe("the text half", () => {
  it("saturates instead of being normalised against the answer", () => {
    expect(textScoreOf(0)).toBe(0);
    expect(textScoreOf(TEXT_SATURATION)).toBe(0.5);
    expect(textScoreOf(10)).toBeGreaterThan(0.98);
  });

  it("keeps a weak rank weak even when it is the best of the answer", () => {
    const [only] = rankSearchHits([{ id: "a", textRank: 0.01, vectorDistance: null }]);
    expect(only?.textScore).toBeLessThan(0.1);
  });

  it("is monotonic in the rank", () => {
    expect(textScoreOf(0.2)).toBeGreaterThan(textScoreOf(0.1));
    expect(textScoreOf(1)).toBeGreaterThan(textScoreOf(0.2));
  });
});

describe("combining the two halves", () => {
  it("weights both halves when the row is embedded", () => {
    expect(combineScores(1, 1)).toBe(TEXT_WEIGHT + VECTOR_WEIGHT);
    expect(combineScores(1, 0)).toBe(TEXT_WEIGHT);
    expect(combineScores(0, 1)).toBe(VECTOR_WEIGHT);
  });

  it("gives the whole score to the text half when the row has no embedding", () => {
    expect(combineScores(1, null)).toBe(1);
    expect(combineScores(0.5, null)).toBe(0.5);
  });

  it("does not bury a row the embedding pass has not reached yet", () => {
    const notEmbedded = combineScores(1, null);
    const embeddedAndClose = combineScores(1, 1);
    expect(notEmbedded).toBeGreaterThanOrEqual(embeddedAndClose);
  });
});

describe("what the row matched on", () => {
  it("separates words, meaning and both", () => {
    expect(matchKindOf(0.4, null)).toBe("words");
    expect(matchKindOf(0.4, 0.1)).toBe("words");
    expect(matchKindOf(0, 0.9)).toBe("meaning");
    expect(matchKindOf(0.4, 0.9)).toBe("both");
  });

  it("calls a neighbour just under the threshold a word match, never a meaning one", () => {
    expect(matchKindOf(0.2, MEANING_THRESHOLD - 0.01)).toBe("words");
    expect(matchKindOf(0.2, MEANING_THRESHOLD)).toBe("both");
  });
});

describe("ranking an answer", () => {
  it("orders two rows of the same kind by their rank", () => {
    const ranked = rankSearchHits([
      { id: "a", textRank: 0.8, vectorDistance: null },
      { id: "b", textRank: 0.2, vectorDistance: null },
    ]);
    expect(ranked.map((hit) => hit.id)).toEqual(["a", "b"]);
    expect(ranked[0]?.textScore).toBe(textScoreOf(0.8));
    expect(ranked[1]?.textScore).toBe(textScoreOf(0.2));
  });

  it("lets a close neighbour outrank a barely lexical hit", () => {
    const ranked = rankSearchHits([
      { id: "lexical", textRank: 0.01, vectorDistance: null },
      { id: "semantic", textRank: 0, vectorDistance: 0.05 },
    ]);
    expect(ranked[0]?.id).toBe("semantic");
  });

  it("keeps a strong lexical hit above a merely close neighbour", () => {
    const ranked = rankSearchHits([
      { id: "lexical", textRank: 1, vectorDistance: null },
      { id: "semantic", textRank: 0, vectorDistance: 0.05 },
    ]);
    expect(ranked[0]?.id).toBe("lexical");
  });

  it("keeps a row found only on meaning and labels it", () => {
    const ranked = rankSearchHits([
      { id: "lexical", textRank: 0.01, vectorDistance: null },
      { id: "semantic", textRank: 0, vectorDistance: 0.05 },
    ]);
    expect(ranked.map((hit) => hit.id)).toEqual(["semantic", "lexical"]);
    expect(ranked[0]?.matchedOn).toBe("meaning");
    expect(ranked[1]?.matchedOn).toBe("words");
  });

  it("returns every row when nothing matched on words", () => {
    const ranked = rankSearchHits([
      { id: "a", textRank: 0, vectorDistance: 0.4 },
      { id: "b", textRank: 0, vectorDistance: 0.9 },
    ]);
    expect(ranked.map((hit) => hit.id)).toEqual(["a", "b"]);
    expect(ranked.every((hit) => hit.textScore === 0)).toBe(true);
  });

  it("breaks a tie on the identifier so two calls order the same rows the same way", () => {
    const ranked = rankSearchHits([
      { id: "z", textRank: 0.5, vectorDistance: null },
      { id: "a", textRank: 0.5, vectorDistance: null },
    ]);
    expect(ranked.map((hit) => hit.id)).toEqual(["a", "z"]);
  });

  it("answers nothing on an empty corpus instead of dividing by zero", () => {
    expect(rankSearchHits([])).toEqual([]);
  });
});
