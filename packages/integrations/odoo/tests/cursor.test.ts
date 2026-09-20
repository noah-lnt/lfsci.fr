import {
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  OVERLAP_MS,
  overlapFrom,
  toOdooDateTime,
} from "@lfsci/odoo";
import { describe, expect, it } from "vitest";

describe("cursor", () => {
  it("round-trips through base64url", () => {
    const cursor = { writeDate: "2026-01-15 09:30:00", id: 42 };
    const encoded = encodeCursor(cursor);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it("refuses a malformed cursor with VALIDATION", () => {
    expect(() => decodeCursor("not-base64-json")).toThrowError(/curseur Odoo/);
  });

  it("shifts the overlap window back by ten minutes", () => {
    expect(overlapFrom("2026-01-15 09:30:00")).toBe("2026-01-15 09:20:00");
    expect(OVERLAP_MS).toBe(600_000);
    expect(toOdooDateTime(new Date("2026-01-15T09:30:00Z"))).toBe("2026-01-15 09:30:00");
  });

  it("orders rows on the (write_date, id) pair", () => {
    const cursor = { writeDate: "2026-01-15 09:30:00", id: 42 };
    expect(isAfterCursor({ writeDate: "2026-01-15 09:30:00", id: 43 }, cursor)).toBe(true);
    expect(isAfterCursor({ writeDate: "2026-01-15 09:30:00", id: 42 }, cursor)).toBe(false);
    expect(isAfterCursor({ writeDate: "2026-01-15 09:29:59", id: 99 }, cursor)).toBe(false);
    expect(isAfterCursor({ writeDate: "2026-01-15 09:31:00", id: 1 }, cursor)).toBe(true);
    expect(isAfterCursor({ writeDate: "2020-01-01 00:00:00", id: 1 }, undefined)).toBe(true);
  });
});
