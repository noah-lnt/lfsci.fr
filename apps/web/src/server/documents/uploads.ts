import "server-only";
import type { api, DocumentEntity } from "@lfsci/contracts";
import { ensureObjectRef, linkActivity, recordAudit, type Tx, tables } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { documentKey, MAX_UPLOAD_BYTES, sniffContentType } from "@lfsci/storage";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { requireRow } from "../patrimoine/rows";
import { enqueueJob } from "../queue";
import type { DocumentStore } from "../storage";
import { getDocument, getDocumentRow, type Scope } from "./repository";
import { isAcceptedContentType } from "./rows";

export type CreateUploadInput = api.documents.CreateUploadInput;
export type FinalizeUploadInput = api.documents.FinalizeUploadInput;
export type CreateUploadOutput = api.documents.CreateUploadOutput;

const SNIFF_BYTES = 512;
const DOWNLOAD_SECONDS = 300;

/**
 * Step one of the two-step upload (spec §16.1): the document row is opened in
 * `uploading` state so the pending version carries the storage key, and the
 * browser gets a presigned PUT — never a credential.
 */
export async function createUpload(
  tx: Tx,
  scope: Scope,
  store: DocumentStore,
  input: CreateUploadInput,
): Promise<CreateUploadOutput> {
  // The capability check comes before anything is written (a refusal costs nothing).
  if (!isAcceptedContentType(input.contentType)) {
    throw new AppError("UNSUPPORTED_MEDIA", {
      message: "Seuls les PDF et les images (PNG, JPEG, WebP, HEIC) sont acceptés.",
      details: { contentType: input.contentType },
    });
  }
  if (input.contentLength > MAX_UPLOAD_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", {
      details: { contentLength: input.contentLength, maxUploadBytes: MAX_UPLOAD_BYTES },
    });
  }

  // A retry after a failed PUT or finalize must not leave an orphan and create a
  // twin: the same bytes still waiting for their upload get the same document.
  const pending = await tx
    .select({
      documentId: tables.documentVersion.documentId,
      uploadId: tables.documentVersion.id,
      storageKey: tables.documentVersion.storageKey,
    })
    .from(tables.documentVersion)
    .innerJoin(tables.document, eq(tables.document.id, tables.documentVersion.documentId))
    .where(
      and(
        eq(tables.documentVersion.organizationId, scope.organizationId),
        eq(tables.documentVersion.sha256, input.sha256),
        eq(tables.documentVersion.sequence, 1),
        eq(tables.document.status, "uploading"),
      ),
    )
    .limit(1);
  const reused = pending[0];
  if (reused) {
    const presigned = await store.presignUpload({
      key: reused.storageKey,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
    return {
      uploadId: reused.uploadId,
      documentId: reused.documentId,
      url: presigned.url,
      method: "PUT",
      headers: presigned.headers,
      expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
    };
  }

  const documentId = uuidv7();
  const uploadId = uuidv7();
  const storageKey = documentKey({
    organizationId: scope.organizationId,
    documentId,
    version: 1,
    filename: input.filename,
  });

  await tx.insert(tables.document).values({
    id: documentId,
    organizationId: scope.organizationId,
    title: input.filename,
    nature: "to_qualify",
    status: "uploading",
  });
  await tx.insert(tables.documentVersion).values({
    id: uploadId,
    organizationId: scope.organizationId,
    documentId,
    sequence: 1,
    role: "original",
    storageKey,
    contentType: input.contentType,
    byteSize: input.contentLength,
    sha256: input.sha256,
    // D-07: no ClamAV in the MVP stack, so the scan is declared skipped, never "clean".
    virusScanStatus: "skipped",
    metadataMissing: true,
  });

  const presigned = await store.presignUpload({
    key: storageKey,
    contentType: input.contentType,
    contentLength: input.contentLength,
  });

  return {
    uploadId,
    documentId,
    url: presigned.url,
    method: "PUT",
    headers: presigned.headers,
    expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
  };
}

export type FinalizeResult = { document: DocumentEntity; analysisQueued: boolean };

/**
 * Step two: what is actually in the bucket decides. Size comes from `headObject`,
 * the type from the first bytes, and only then does the document become active.
 */
export async function finalizeUpload(
  tx: Tx,
  scope: Scope,
  store: DocumentStore,
  input: FinalizeUploadInput,
): Promise<FinalizeResult> {
  const document = await getDocumentRow(tx, input.documentId);
  const versions = await tx
    .select()
    .from(tables.documentVersion)
    .where(
      and(
        eq(tables.documentVersion.id, input.uploadId),
        eq(tables.documentVersion.documentId, input.documentId),
      ),
    );
  const pending = requireRow(versions[0], "document_version");

  if (pending.sha256 !== input.sha256) {
    throw new AppError("VALIDATION", {
      message: "L’empreinte déclarée ne correspond pas à celle du téléversement.",
      details: { uploadId: input.uploadId },
    });
  }

  const head = await store.headObject(pending.storageKey);
  if (head.contentLength !== input.contentLength) {
    throw new AppError("VALIDATION", {
      message: "La taille du fichier reçu ne correspond pas à celle annoncée.",
      details: { announced: input.contentLength, stored: head.contentLength },
    });
  }

  const first = await store.readRange(pending.storageKey, SNIFF_BYTES);
  // Sniffing wins; the stored content-type is only a fallback when the object
  // is empty or unreadable, and it is never trusted to accept a type.
  const detected = sniffContentType(first) ?? head.contentType ?? pending.contentType;
  if (!isAcceptedContentType(detected)) {
    await tx
      .update(tables.document)
      .set({ status: "rejected", updatedAt: new Date().toISOString() })
      .where(eq(tables.document.id, input.documentId));
    throw new AppError("UNSUPPORTED_MEDIA", {
      message: "Le contenu du fichier n’est pas un PDF ni une image.",
      details: { detected },
    });
  }

  const now = new Date().toISOString();
  const metadata = input.metadata;

  await tx
    .update(tables.documentVersion)
    .set({
      byteSize: head.contentLength,
      detectedType: detected,
      receivedAt: now,
      capturedByUserId: scope.actorId,
      metadataMissing: metadata === undefined,
      updatedAt: now,
    })
    .where(eq(tables.documentVersion.id, pending.id));

  await tx
    .update(tables.document)
    .set({
      status: "active",
      currentVersionId: pending.id,
      ...(metadata === undefined
        ? {}
        : {
            title: metadata.title,
            nature: metadata.nature,
            ...(metadata.confidentiality === undefined
              ? {}
              : { confidentiality: metadata.confidentiality }),
            ...(metadata.periodStart === undefined ? {} : { periodStart: metadata.periodStart }),
            ...(metadata.periodEnd === undefined ? {} : { periodEnd: metadata.periodEnd }),
            ...(metadata.retentionClass === undefined
              ? {}
              : { retentionClass: metadata.retentionClass }),
          }),
      updatedAt: now,
    })
    .where(eq(tables.document.id, input.documentId));

  const documentRefId = await ensureObjectRef(tx, {
    organizationId: scope.organizationId,
    kind: "document",
    id: input.documentId,
  });

  const linkedRefIds = [documentRefId];
  for (const link of metadata?.links ?? []) {
    const objectRefId = await ensureObjectRef(tx, {
      organizationId: scope.organizationId,
      kind: link.object.kind,
      id: link.object.id,
    });
    await tx
      .insert(tables.documentLink)
      .values({
        organizationId: scope.organizationId,
        documentId: input.documentId,
        objectRefId,
        relation: link.relation,
      })
      .onConflictDoNothing();
    linkedRefIds.push(objectRefId);
  }

  // CAP-01/TMP-01: the capture itself is a timeline fact, on the document and
  // on every object it was attached to.
  const activities = await tx
    .insert(tables.activity)
    .values({
      organizationId: scope.organizationId,
      channel: "file",
      direction: "inbound",
      subject: metadata?.title ?? document.title,
      declaredAuthor: null,
      authorUserId: scope.actorId,
      capturedAt: now,
      occurredAt: now,
    })
    .returning({ id: tables.activity.id });
  const activity = requireRow(activities[0], "activity");
  for (const objectRefId of linkedRefIds) {
    await linkActivity(tx, {
      organizationId: scope.organizationId,
      activityId: activity.id,
      objectRefId,
      relation: "about",
      occurredAt: now,
    });
  }

  await recordAudit(tx, {
    organizationId: scope.organizationId,
    actorKind: "user",
    actorUserId: scope.actorId,
    objectTable: "document",
    objectId: input.documentId,
    objectRefId: documentRefId,
    action: "document_captured",
    afterValue: {
      storageKey: pending.storageKey,
      byteSize: head.contentLength,
      detectedType: detected,
    },
  });

  const entity = await getDocument(tx, input.documentId);
  const jobId = await enqueueJob("document.analyze", {
    organizationId: scope.organizationId,
    documentId: input.documentId,
    documentVersionId: pending.id,
    kind: entity.nature,
  });

  return { document: entity, analysisQueued: jobId !== null };
}

export async function downloadUrl(
  tx: Tx,
  scope: Scope,
  store: DocumentStore,
  documentId: string,
): Promise<{ url: string; expiresAt: string }> {
  const document = await getDocumentRow(tx, documentId);
  if (!document.currentVersionId) {
    throw new AppError("NOT_FOUND", { details: { object: "document_version" } });
  }
  const versions = await tx
    .select()
    .from(tables.documentVersion)
    .where(eq(tables.documentVersion.id, document.currentVersionId));
  const version = requireRow(versions[0], "document_version");

  const url = await store.presignDownload({
    key: version.storageKey,
    expiresInSeconds: DOWNLOAD_SECONDS,
    downloadFilename: document.title,
  });

  await recordAudit(tx, {
    organizationId: scope.organizationId,
    actorKind: "user",
    actorUserId: scope.actorId,
    objectTable: "document",
    objectId: documentId,
    action: "document_downloaded",
    afterValue: { storageKey: version.storageKey },
  });

  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_SECONDS * 1000).toISOString() };
}
