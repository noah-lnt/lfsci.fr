import { z } from "zod";
import {
  DocumentConfidentiality,
  DocumentLinkRelation,
  DocumentStatus,
  DocumentVersionRole,
  DocumentVersionVirusScanStatus,
} from "../enums";
import { Audited, IsoDate, IsoDateTime, Uuid, Version } from "../primitives";
import { ObjectRef } from "./common";

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "empreinte sha256 hexadécimale attendue");
export type Sha256 = z.infer<typeof Sha256>;

export const DocumentVersion = Audited.extend({
  documentId: Uuid,
  sequence: z.number().int().positive(),
  role: DocumentVersionRole,
  storageKey: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  sha256: Sha256,
  detectedType: z.string().nullable(),
  virusScanStatus: DocumentVersionVirusScanStatus,
  capturedAt: IsoDateTime.nullable(),
  receivedAt: IsoDateTime,
  metadataMissing: z.boolean(),
  derivedFromVersionId: Uuid.nullable(),
});
export type DocumentVersion = z.infer<typeof DocumentVersion>;

export const DocumentEntity = Audited.extend({
  title: z.string(),
  nature: z.string(),
  confidentiality: DocumentConfidentiality,
  periodStart: IsoDate.nullable(),
  periodEnd: IsoDate.nullable(),
  retentionClass: z.string().nullable(),
  retentionUntil: IsoDate.nullable(),
  legalHold: z.boolean(),
  status: DocumentStatus,
  currentVersion: DocumentVersion.nullable(),
  links: z.array(z.object({ relation: DocumentLinkRelation, object: ObjectRef })),
});
export type DocumentEntity = z.infer<typeof DocumentEntity>;

export const CreateDocumentMetadataInput = z.strictObject({
  title: z.string().min(1),
  nature: z.string().min(1),
  confidentiality: DocumentConfidentiality.optional(),
  periodStart: IsoDate.optional(),
  periodEnd: IsoDate.optional(),
  retentionClass: z.string().optional(),
  links: z.array(z.strictObject({ relation: DocumentLinkRelation, object: ObjectRef })).optional(),
});
export type CreateDocumentMetadataInput = z.infer<typeof CreateDocumentMetadataInput>;

export const UpdateDocumentMetadataInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  title: z.string().min(1).optional(),
  nature: z.string().min(1).optional(),
  confidentiality: DocumentConfidentiality.optional(),
  periodStart: IsoDate.nullable().optional(),
  periodEnd: IsoDate.nullable().optional(),
  retentionClass: z.string().nullable().optional(),
  legalHold: z.boolean().optional(),
  status: DocumentStatus.optional(),
});
export type UpdateDocumentMetadataInput = z.infer<typeof UpdateDocumentMetadataInput>;
