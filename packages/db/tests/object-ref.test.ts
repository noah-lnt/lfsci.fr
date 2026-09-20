import { commandTargetOf, versionedTableByKind } from "@lfsci/db";
import { describe, expect, it } from "vitest";

describe("command target registry", () => {
  it("names the object a command is about, most specific id first", () => {
    expect(commandTargetOf({ rentTermId: "a", leaseId: "b" })).toEqual({
      kind: "rent_term",
      id: "a",
    });
    expect(commandTargetOf({ ccaId: "x", ccaMovementId: "m", expenseId: "e" })).toEqual({
      kind: "cca_movement",
      id: "m",
    });
    expect(commandTargetOf({ expenseId: "e", supplierId: "s" })).toEqual({
      kind: "expense",
      id: "e",
    });
    expect(commandTargetOf({ leaseId: "l" })).toEqual({ kind: "lease", id: "l" });
  });

  it("reads a payload with no versioned object as nothing to check", () => {
    expect(commandTargetOf({ documentVersionId: "d" })).toBeNull();
    expect(commandTargetOf({ expenseId: null })).toBeNull();
    expect(commandTargetOf(null)).toBeNull();
    expect(commandTargetOf("lease")).toBeNull();
  });

  it("only registers kinds whose table carries a version column", () => {
    for (const table of Object.values(versionedTableByKind)) {
      expect(table.version).toBeDefined();
    }
  });
});
