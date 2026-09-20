import { describe, expect, it } from "vitest";
import { countByHorizon, horizonOf } from "./horizon";

const TODAY = "2026-09-20";

describe("horizonOf", () => {
  it("keeps late apart from the 7-day bucket (TMP-03)", () => {
    expect(horizonOf("2026-09-19", TODAY)).toBe("overdue");
    expect(horizonOf(TODAY, TODAY)).toBe("d7");
  });

  it("walks the declared horizons", () => {
    expect(horizonOf("2026-09-27", TODAY)).toBe("d7");
    expect(horizonOf("2026-09-28", TODAY)).toBe("d30");
    expect(horizonOf("2026-10-20", TODAY)).toBe("d30");
    expect(horizonOf("2026-12-01", TODAY)).toBe("d90");
    expect(horizonOf("2027-06-01", TODAY)).toBe("d365");
    expect(horizonOf("2028-01-01", TODAY)).toBe("later");
  });
});

describe("countByHorizon", () => {
  it("counts every bucket, including the empty ones", () => {
    expect(
      countByHorizon([{ horizon: "overdue" }, { horizon: "overdue" }, { horizon: "d30" }]),
    ).toEqual({ overdue: 2, d7: 0, d30: 1, d90: 0, d365: 0, later: 0 });
  });
});
