import { describe, expect, it } from "vitest";
import { normalizeFrenchMobile } from "../src/phone";

describe("normalizeFrenchMobile", () => {
  it("normalises a French mobile to E.164", () => {
    expect(normalizeFrenchMobile("06 12 34 56 78")).toEqual({
      ok: true,
      e164: "+33612345678",
      country: "FR",
      type: "MOBILE",
    });
  });

  it("refuses a landline, a premium-rate and a toll-free number", () => {
    expect(normalizeFrenchMobile("01 45 67 89 01")).toEqual({ ok: false, reason: "not_mobile" });
    expect(normalizeFrenchMobile("08 90 12 34 56")).toEqual({ ok: false, reason: "not_mobile" });
    expect(normalizeFrenchMobile("08 00 12 34 56")).toEqual({ ok: false, reason: "not_mobile" });
  });

  it("refuses a Guadeloupe number dialled with the metropolitan country code", () => {
    expect(normalizeFrenchMobile("0690123456")).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts the same Guadeloupe number under its own dial code", () => {
    expect(normalizeFrenchMobile("+590690123456")).toMatchObject({ ok: true, country: "GP" });
    expect(normalizeFrenchMobile("0690123456", "GP")).toMatchObject({
      ok: true,
      e164: "+590690123456",
      type: "MOBILE",
    });
  });

  it("accepts a North American number whose type is indistinguishable", () => {
    expect(normalizeFrenchMobile("+12125551234")).toMatchObject({
      ok: true,
      type: "FIXED_LINE_OR_MOBILE",
    });
  });

  it("refuses empty and malformed input", () => {
    expect(normalizeFrenchMobile("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeFrenchMobile("bonjour")).toEqual({ ok: false, reason: "unparseable" });
    expect(normalizeFrenchMobile("+33 1")).toEqual({ ok: false, reason: "unparseable" });
    expect(normalizeFrenchMobile("+33 6 12 34 56 78 90")).toEqual({ ok: false, reason: "invalid" });
  });
});
