import { describe, expect, it } from "vitest";
import { isAcceptedContentType, toDocument, toDocumentVersion } from "./rows";

const audited = {
  id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  organizationId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
  createdAt: "2026-09-20 06:30:00.123+00",
  updatedAt: null,
  version: 1,
};

const versionRow = {
  ...audited,
  documentId: audited.organizationId,
  sequence: 1,
  role: "original",
  storageKey: "org/x/doc/y/v1/ticket.png",
  contentType: "image/png",
  byteSize: 1024,
  sha256: "a".repeat(64),
  detectedType: "image/png",
  virusScanStatus: "skipped",
  capturedAt: null,
  receivedAt: "2026-09-20 06:30:05+00",
  capturedByUserId: null,
  metadataMissing: false,
  derivedFromVersionId: null,
};

const documentRow = {
  ...audited,
  title: "ticket.png",
  nature: "to_qualify",
  confidentiality: "internal",
  periodStart: null,
  periodEnd: null,
  authorPersonId: null,
  authorUserId: null,
  currentVersionId: audited.id,
  retentionClass: null,
  retentionUntil: null,
  legalHold: false,
  archivedAt: null,
  purgedAt: null,
  status: "active",
};

describe("isAcceptedContentType", () => {
  it("accepts PDF and the image types the capture flow declares", () => {
    for (const type of [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "IMAGE/PNG",
      "image/jpeg; charset=binary",
    ]) {
      expect(isAcceptedContentType(type)).toBe(true);
    }
  });

  it("refuses anything else, including a type that merely starts right", () => {
    for (const type of [
      "text/html",
      "application/zip",
      "application/x-msdownload",
      "image/svg+xml",
      "application/pdfx",
      "",
    ]) {
      expect(isAcceptedContentType(type)).toBe(false);
    }
  });
});

describe("document mappers", () => {
  it("maps a version with its byte size as a number and ISO timestamps", () => {
    const version = toDocumentVersion(versionRow);
    expect(version.byteSize).toBe(1024);
    expect(version.receivedAt).toBe("2026-09-20T06:30:05.000Z");
    expect(version.virusScanStatus).toBe("skipped");
    expect(version).not.toHaveProperty("organizationId");
    expect(version).not.toHaveProperty("capturedByUserId");
  });

  it("carries the current version and the links", () => {
    const document = toDocument(documentRow, versionRow, [
      { relation: "attached", object: { kind: "unit", id: audited.organizationId } },
    ]);
    expect(document.currentVersion?.storageKey).toBe(versionRow.storageKey);
    expect(document.links).toEqual([
      { relation: "attached", object: { kind: "unit", id: audited.organizationId } },
    ]);
    expect(document.status).toBe("active");
  });

  it("renders a document with no stored object as having no version", () => {
    const document = toDocument({ ...documentRow, currentVersionId: null }, null, []);
    expect(document.currentVersion).toBeNull();
    expect(document.links).toEqual([]);
  });
});
