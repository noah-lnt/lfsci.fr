import type { DocumentEntity, DocumentVersion, ObjectRef } from "@lfsci/contracts";
import type { tables } from "@lfsci/db";
import { instant, instantOrNull } from "../patrimoine/rows";

type DocumentRow = typeof tables.document.$inferSelect;
type VersionRow = typeof tables.documentVersion.$inferSelect;

export type DocumentLinkView = {
  relation: DocumentEntity["links"][number]["relation"];
  object: ObjectRef;
};

/** Types the capture flow accepts; anything else is refused before it is stored. */
export const ACCEPTED_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
] as const;

export function isAcceptedContentType(value: string): boolean {
  const base = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return (ACCEPTED_CONTENT_TYPES as readonly string[]).includes(base);
}

export function toDocumentVersion(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    createdAt: instant(row.createdAt),
    updatedAt: instantOrNull(row.updatedAt),
    version: row.version,
    documentId: row.documentId,
    sequence: row.sequence,
    role: row.role as DocumentVersion["role"],
    storageKey: row.storageKey,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    detectedType: row.detectedType,
    virusScanStatus: row.virusScanStatus as DocumentVersion["virusScanStatus"],
    capturedAt: instantOrNull(row.capturedAt),
    receivedAt: instant(row.receivedAt),
    metadataMissing: row.metadataMissing,
    derivedFromVersionId: row.derivedFromVersionId,
  };
}

export function toDocument(
  row: DocumentRow,
  currentVersion: VersionRow | null,
  links: DocumentLinkView[],
): DocumentEntity {
  return {
    id: row.id,
    createdAt: instant(row.createdAt),
    updatedAt: instantOrNull(row.updatedAt),
    version: row.version,
    title: row.title,
    nature: row.nature,
    confidentiality: row.confidentiality as DocumentEntity["confidentiality"],
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    retentionClass: row.retentionClass,
    retentionUntil: row.retentionUntil,
    legalHold: row.legalHold,
    status: row.status as DocumentEntity["status"],
    currentVersion: currentVersion ? toDocumentVersion(currentVersion) : null,
    links,
  };
}
