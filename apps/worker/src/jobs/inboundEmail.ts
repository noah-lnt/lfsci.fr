import { createHash } from "node:crypto";
import { ensureObjectRef, linkActivity, tables, withTenant } from "@lfsci/db";
import { AppError, logger, newId } from "@lfsci/kernel";
import { documentKey } from "@lfsci/storage";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.inbound.email");

export const InboundEmailData = JobBase.extend({
  organizationId: z.uuid(),
  emailId: z.string().min(1),
});
export type InboundEmailData = z.infer<typeof InboundEmailData>;

export type StoredAttachment = { documentId: string; documentVersionId: string; filename: string };

export async function ingestInboundEmail(deps: Deps, data: InboundEmailData): Promise<JobOutcome> {
  if (!deps.mail) return { outcome: "sources_unavailable", missing: ["mail"] };
  const reader = deps.mail;
  const { organizationId, emailId } = data;

  // INT-01: the provider id is the dedup key, checked before any side effect.
  const existing = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select({ id: tables.activity.id })
      .from(tables.activity)
      .where(and(eq(tables.activity.channel, "email"), eq(tables.activity.externalId, emailId)))
      .limit(1);
    return rows[0];
  });
  if (existing) return { outcome: "duplicate", activityId: existing.id };

  const email = await reader.getInboundEmail(emailId);
  const attachments = email.attachments ?? [];

  const stored: StoredAttachment[] = [];
  for (const attachment of attachments) {
    if (!deps.storage) {
      log.warn({ emailId }, "storage absent, attachment kept as a reference only");
      break;
    }
    const bytes = await reader.getInboundAttachment(emailId, attachment.id);
    const documentId = newId();
    const key = documentKey({
      organizationId,
      documentId,
      version: 1,
      filename: attachment.filename,
    });
    const upload = await deps.storage.presignUpload({
      key,
      contentType: attachment.content_type ?? "application/octet-stream",
      contentLength: bytes.byteLength,
    });
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: bytes,
    });
    if (!response.ok) {
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        message: "attachment upload failed",
        details: { status: response.status },
      });
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const documentVersionId = await withTenant(deps.db, { organizationId }, async (tx) => {
      await tx.insert(tables.document).values({
        id: documentId,
        organizationId,
        title: attachment.filename,
        nature: "other",
      });
      const rows = await tx
        .insert(tables.documentVersion)
        .values({
          organizationId,
          documentId,
          sequence: 1,
          role: "original",
          storageKey: key,
          contentType: attachment.content_type ?? "application/octet-stream",
          byteSize: bytes.byteLength,
          sha256,
        })
        .returning({ id: tables.documentVersion.id });
      const row = rows[0];
      if (!row)
        throw new AppError("CONFLICT", { message: "document_version insert returned none" });
      await tx
        .update(tables.document)
        .set({ currentVersionId: row.id })
        .where(eq(tables.document.id, documentId));
      return row.id;
    });
    stored.push({ documentId, documentVersionId, filename: attachment.filename });
  }

  const { activityId, inboxItemId } = await withTenant(deps.db, { organizationId }, async (tx) => {
    const activityRows = await tx
      .insert(tables.activity)
      .values({
        organizationId,
        channel: "email",
        direction: "inbound",
        subject: email.subject ?? null,
        bodyRaw: email.text ?? email.html ?? null,
        declaredAuthor: email.from,
        externalId: emailId,
        occurredAt: new Date().toISOString(),
      })
      .returning({ id: tables.activity.id });
    const activity = activityRows[0];
    if (!activity) throw new AppError("CONFLICT", { message: "activity insert returned none" });

    const inboxRows = await tx
      .insert(tables.inboxItem)
      .values({
        organizationId,
        activityId: activity.id,
        documentId: stored[0]?.documentId ?? null,
        source: "email_forward",
        sourceReference: emailId,
        status: "received",
      })
      .returning({ id: tables.inboxItem.id });
    const inbox = inboxRows[0];
    if (!inbox) throw new AppError("CONFLICT", { message: "inbox_item insert returned none" });

    for (const item of stored) {
      const objectRefId = await ensureObjectRef(tx, {
        organizationId,
        kind: "document",
        id: item.documentId,
      });
      await linkActivity(tx, { organizationId, activityId: activity.id, objectRefId });
    }
    return { activityId: activity.id, inboxItemId: inbox.id };
  });

  for (const item of stored) {
    await deps.boss.send("document.analyze", {
      requestId: data.requestId,
      organizationId,
      documentVersionId: item.documentVersionId,
      kind: "invoice",
      inboxItemId,
    });
  }

  return { outcome: "ingested", activityId, inboxItemId, attachments: stored.length };
}

export const inboundEmail = defineJob({
  name: "inbound.email",
  schema: InboundEmailData,
  options: {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 300,
    localConcurrency: 2,
  },
  handler: (data, deps) => ingestInboundEmail(deps, data),
});
