import { z } from "zod";
import {
  byId,
  CreateDocumentMetadataInput,
  DocumentEntity,
  listInput,
  paginated,
  Sha256,
  UpdateDocumentMetadataInput,
} from "../entities";
import { DocumentStatus } from "../enums";
import { IsoDateTime, Uuid } from "../primitives";

/** Spec §16.1: POST /v1/documents/uploads returns a presigned PUT; the browser never holds S3 credentials. */
export const CreateUploadInput = z.strictObject({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  contentLength: z.number().int().positive(),
  sha256: Sha256,
});
export type CreateUploadInput = z.infer<typeof CreateUploadInput>;

export const CreateUploadOutput = z.object({
  uploadId: Uuid,
  documentId: Uuid,
  url: z.url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: IsoDateTime,
});
export type CreateUploadOutput = z.infer<typeof CreateUploadOutput>;

export const FinalizeUploadInput = z.strictObject({
  uploadId: Uuid,
  documentId: Uuid,
  sha256: Sha256,
  contentLength: z.number().int().positive(),
  metadata: CreateDocumentMetadataInput.optional(),
});
export type FinalizeUploadInput = z.infer<typeof FinalizeUploadInput>;

export const createUpload = { input: CreateUploadInput, output: CreateUploadOutput };
export const finalizeUpload = {
  input: FinalizeUploadInput,
  output: z.object({ document: DocumentEntity, analysisQueued: z.boolean() }),
};

export const listDocuments = {
  input: listInput({
    nature: z.string().optional(),
    status: DocumentStatus.optional(),
    search: z.string().optional(),
  }),
  output: paginated(DocumentEntity),
};
export const getDocument = { input: byId, output: DocumentEntity };
export const updateDocumentMetadata = {
  input: UpdateDocumentMetadataInput,
  output: DocumentEntity,
};
export const getDownloadUrl = {
  input: byId,
  output: z.object({ url: z.url(), expiresAt: IsoDateTime }),
};
