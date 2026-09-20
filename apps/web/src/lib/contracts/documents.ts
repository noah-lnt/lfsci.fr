import { api, DocumentEntity, DocumentLinkRelation, ObjectRef, Uuid } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Mirrors `MAX_UPLOAD_BYTES` in `@lfsci/storage`, which cannot be imported by a
 * client component: that package's entry point pulls the S3 SDK and `node:fs`.
 * The server stays authoritative — this only spares the user a doomed upload.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** DOC-01: one stored original, many objects pointing at it. */
export const LinkDocumentInput = z.strictObject({
  documentId: Uuid,
  object: ObjectRef,
  relation: DocumentLinkRelation.default("attached"),
  reason: z.string().max(500).optional(),
});
export type LinkDocumentInput = z.infer<typeof LinkDocumentInput>;

/** Library filters beyond the shared list input: one object, one period. */
export const ListDocumentsInput = api.documents.listDocuments.input.extend({
  object: ObjectRef.optional(),
  periodFrom: z.iso.date().optional(),
  periodTo: z.iso.date().optional(),
});
export type ListDocumentsInput = z.infer<typeof ListDocumentsInput>;

export const documentsContract = {
  documents: {
    list: oc
      .route({ method: "GET", path: "/documents", summary: "Bibliothèque documentaire" })
      .input(ListDocumentsInput)
      .output(api.documents.listDocuments.output),
    get: oc
      .route({ method: "GET", path: "/documents/{id}", summary: "Un document" })
      .input(api.documents.getDocument.input)
      .output(api.documents.getDocument.output),
    createUpload: oc
      .route({ method: "POST", path: "/documents/uploads", summary: "Ouvrir un téléversement" })
      .input(api.documents.createUpload.input)
      .output(api.documents.createUpload.output),
    finalizeUpload: oc
      .route({
        method: "POST",
        path: "/documents/uploads/finalize",
        summary: "Clore un téléversement",
      })
      .input(api.documents.finalizeUpload.input)
      .output(api.documents.finalizeUpload.output),
    download: oc
      .route({ method: "GET", path: "/documents/{id}/download", summary: "Lien de téléchargement" })
      .input(api.documents.getDownloadUrl.input)
      .output(api.documents.getDownloadUrl.output),
    link: oc
      .route({ method: "POST", path: "/documents/links", summary: "Rattacher un document" })
      .input(LinkDocumentInput)
      .output(DocumentEntity),
  },
};
