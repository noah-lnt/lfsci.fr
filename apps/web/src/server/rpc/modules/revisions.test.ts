import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Component graph; the boundary it
// guards is a lint concern, not something this pure-function test exercises.
vi.mock("server-only", () => ({}));

const { revisionDueDate, territoryOf } = await import("./revisions");

type LeaseLike = Parameters<typeof revisionDueDate>[0];

function lease(patch: Partial<LeaseLike>): LeaseLike {
  return { revisionMonth: null, startsOn: null, ...patch } as LeaseLike;
}

describe("IRL-01 — territorial rules", () => {
  it("reads the overseas départements from the building's postal code", () => {
    expect(territoryOf("64230")).toBe("metropole");
    expect(territoryOf("97400")).toBe("outre_mer");
    expect(territoryOf("98800")).toBe("outre_mer");
    // No address on file must not silently promise the overseas regime.
    expect(territoryOf(null)).toBe("metropole");
  });
});

describe("IRL-01 — the revision is due on the lease's month, never on a guess", () => {
  it("uses the revision month when the lease carries one", () => {
    expect(revisionDueDate(lease({ revisionMonth: 10 }), "2026-09-20")).toBe("2026-10-01");
  });

  it("falls back on the lease's own start month", () => {
    expect(revisionDueDate(lease({ startsOn: "2021-03-15" }), "2026-09-20")).toBe("2026-03-01");
  });

  it("falls back on the request date when the lease has neither", () => {
    expect(revisionDueDate(lease({}), "2026-07-04")).toBe("2026-07-01");
  });
});
