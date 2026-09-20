import { type DocumentKind, type Evidence, extractDocument } from "@lfsci/ai";
import { tables, withTenant } from "@lfsci/db";
import { AppError, logger } from "@lfsci/kernel";
import { sniffContentType } from "@lfsci/storage";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.document.analyze");

export const MAX_IMAGE_EDGE = 2000;
export const JPEG_QUALITY = 82;

export const DocumentAnalyzeData = JobBase.extend({
  organizationId: z.uuid(),
  documentVersionId: z.uuid(),
  kind: z.enum(["receipt", "invoice", "attestation", "lease", "meterPhoto"]),
  inboxItemId: z.uuid().optional(),
});
export type DocumentAnalyzeData = z.infer<typeof DocumentAnalyzeData>;

/** Downscale and re-encode before OCR: iOS captures are far larger than useful. */
export async function normalizeImage(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes)
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return new Uint8Array(out);
}

export type FlatField = {
  fieldPath: string;
  value: string | null;
  confidence: number | null;
  evidence: Evidence | null;
};

function isFieldShape(
  value: unknown,
): value is { value: unknown; confidence: number; evidence: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "confidence" in value &&
    "evidence" in value
  );
}

/** Flattens an extraction into one `ai_extraction` row per leaf field (MOD-02). */
export function flattenExtraction(output: unknown, prefix = ""): FlatField[] {
  if (!output || typeof output !== "object") return [];
  const out: FlatField[] = [];
  for (const [key, raw] of Object.entries(output as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isFieldShape(raw)) {
      out.push({
        fieldPath: path,
        value: raw.value === null || raw.value === undefined ? null : String(raw.value),
        confidence: raw.confidence,
        evidence: (raw.evidence ?? null) as Evidence | null,
      });
      continue;
    }
    if (Array.isArray(raw)) {
      for (const [index, item] of raw.entries()) {
        out.push(...flattenExtraction(item, `${path}.${index}`));
      }
      continue;
    }
    if (raw && typeof raw === "object") out.push(...flattenExtraction(raw, path));
  }
  return out;
}

async function download(deps: Deps, storageKey: string): Promise<Uint8Array> {
  if (!deps.storage) throw new AppError("INTERNAL", { message: "storage not configured" });
  const url = await deps.storage.presignDownload({ key: storageKey });
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      message: "object download failed",
      details: { status: response.status },
    });
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function noteUnavailable(
  deps: Deps,
  data: DocumentAnalyzeData,
  missing: string[],
): Promise<JobOutcome> {
  const reason = `sources indisponibles: ${missing.join(", ")}`;
  if (data.inboxItemId) {
    await withTenant(deps.db, { organizationId: data.organizationId }, (tx) =>
      tx
        .update(tables.inboxItem)
        .set({
          status: "received",
          uncertaintyReason: reason,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tables.inboxItem.id, data.inboxItemId as string)),
    );
  }
  log.warn({ missing, documentVersionId: data.documentVersionId }, "analysis skipped");
  return { outcome: "sources_unavailable", missing };
}

export async function analyzeDocument(deps: Deps, data: DocumentAnalyzeData): Promise<JobOutcome> {
  const missing: string[] = [];
  if (!deps.storage) missing.push("storage");
  if (!deps.ocr) missing.push("ocr");
  if (!deps.ai) missing.push("ai");
  if (missing.length > 0) return noteUnavailable(deps, data, missing);
  const storageOk = deps.storage;
  const ocr = deps.ocr;
  const ai = deps.ai;
  if (!storageOk || !ocr || !ai) return noteUnavailable(deps, data, missing);

  const version = await withTenant(deps.db, { organizationId: data.organizationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(tables.documentVersion)
      .where(eq(tables.documentVersion.id, data.documentVersionId))
      .limit(1);
    return rows[0];
  });
  if (!version) throw new AppError("NOT_FOUND", { details: { id: data.documentVersionId } });

  const raw = await download(deps, version.storageKey);
  const sniffed = sniffContentType(raw);
  if (!sniffed) throw new AppError("UNSUPPORTED_MEDIA", { details: { key: version.storageKey } });

  const isPdf = sniffed === "application/pdf";
  const bytes = isPdf ? raw : await normalizeImage(raw);
  const contentType = isPdf ? sniffed : "image/jpeg";

  const ocrResult = await ocr.ocrDocument({ bytes, contentType });
  const ocrText = ocrResult.pages.map((page) => page.markdown).join("\n\n");

  const extraction = await extractDocument(ai, {
    kind: data.kind as DocumentKind,
    ocrText,
    ...(isPdf ? { pdfBase64: Buffer.from(bytes).toString("base64") } : {}),
  });

  if (!extraction.ok) {
    if (data.inboxItemId) {
      await withTenant(deps.db, { organizationId: data.organizationId }, (tx) =>
        tx
          .update(tables.inboxItem)
          .set({
            status: "ambiguous",
            uncertaintyReason: `extraction ${extraction.reason}: ${extraction.detail}`.slice(
              0,
              500,
            ),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(tables.inboxItem.id, data.inboxItemId as string)),
      );
    }
    return { outcome: "extraction_failed", reason: extraction.reason, code: extraction.code };
  }

  const fields = flattenExtraction(extraction.output);
  await withTenant(deps.db, { organizationId: data.organizationId }, async (tx) => {
    if (fields.length > 0) {
      await tx.insert(tables.aiExtraction).values(
        fields.map((field) => ({
          organizationId: data.organizationId,
          sourceDocumentVersionId: data.documentVersionId,
          inboxItemId: data.inboxItemId ?? null,
          fieldPath: field.fieldPath,
          proposedValue: field.value,
          proposedValueJson: field.evidence ? { evidence: field.evidence } : null,
          confidence: field.confidence === null ? null : field.confidence.toFixed(6),
          evidenceExcerpt: field.evidence?.quote ?? null,
          evidencePage: field.evidence?.page ?? null,
          evidenceBbox: field.evidence?.bbox ?? null,
          provider: "anthropic",
          modelName: extraction.modelId,
          promptVersion: extraction.promptVersion,
          decision: "pending" as const,
          autonomyLevel: "A",
        })),
      );
    }
    await tx
      .update(tables.documentVersion)
      .set({ detectedType: sniffed, updatedAt: new Date().toISOString() })
      .where(eq(tables.documentVersion.id, data.documentVersionId));
    if (data.inboxItemId) {
      await tx
        .update(tables.inboxItem)
        .set({ status: "analyzed", updatedAt: new Date().toISOString() })
        .where(eq(tables.inboxItem.id, data.inboxItemId));
    }
  });

  return {
    outcome: "analyzed",
    fields: fields.length,
    pages: ocrResult.usage.pagesProcessed,
    totalsConsistent: extraction.checks?.totalsConsistent ?? null,
  };
}

export const documentAnalyze = defineJob({
  name: "document.analyze",
  schema: DocumentAnalyzeData,
  options: {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 1800,
    expireInSeconds: 600,
    localConcurrency: 2,
  },
  handler: (data, deps) => analyzeDocument(deps, data),
});
