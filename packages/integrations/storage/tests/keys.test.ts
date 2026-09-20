import { describe, expect, it } from "vitest";
import { documentKey, MAX_UPLOAD_BYTES, safeFilename } from "../src/keys";

const org = "0198f0c0-1111-7000-8000-000000000001";
const doc = "0198f0c0-2222-7000-8000-000000000002";

describe("documentKey", () => {
  it("lays out org/doc/version/filename", () => {
    expect(
      documentKey({ organizationId: org, documentId: doc, version: 3, filename: "bail.pdf" }),
    ).toBe(`org/${org}/doc/${doc}/v3/bail.pdf`);
  });

  it("strips accents, spaces and path traversal from the filename", () => {
    expect(safeFilename("../../Quittance Août 2026.pdf")).toBe("Quittance-Aout-2026.pdf");
  });

  it("refuses a non-uuid tenant and a zero version", () => {
    expect(() =>
      documentKey({ organizationId: "x", documentId: doc, version: 1, filename: "a.pdf" }),
    ).toThrow(/uuids/);
    expect(() =>
      documentKey({ organizationId: org, documentId: doc, version: 0, filename: "a.pdf" }),
    ).toThrow(/positive integer/);
  });

  it("caps uploads at 50 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(52428800);
  });
});
