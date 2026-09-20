import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DocumentKind, type Evidence, type ExtractPage, extractDocument } from "@lfsci/ai";
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

/** Caps the model payload: a 60-page lease would blow the context and the VRAM. */
export const MAX_PDF_PAGES = 8;
export const MAX_PAGE_EDGE = 1600;
export const RASTER_TIMEOUT_MS = 20_000;
export const PDFTOPPM_BINARY = "pdftoppm";

/** Injectable so the job is testable without the binary, and swappable per image. */
export type PageRenderer = (input: {
  pdf: Uint8Array;
  maxPages: number;
  maxEdgePx: number;
}) => Promise<ExtractPage[]>;

function renderOnePage(file: string, page: number, maxEdgePx: number): Promise<Buffer> {
  const args = [
    "-jpeg",
    "-jpegopt",
    `quality=${JPEG_QUALITY}`,
    "-scale-to",
    String(maxEdgePx),
    "-f",
    String(page),
    "-l",
    String(page),
    "-singlefile",
    file,
  ];
  return new Promise((resolve, reject) => {
    execFile(
      PDFTOPPM_BINARY,
      args,
      {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        timeout: RASTER_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/**
 * poppler's `pdftoppm`, measured against `pdfjs-dist` + `@napi-rs/canvas` on an
 * eight-page document (tech pack §"Rasterising PDF pages"). It reads a file, not
 * stdin, and exits non-zero once the page number passes the last page.
 */
export const popplerRenderer: PageRenderer = async ({ pdf, maxPages, maxEdgePx }) => {
  const dir = await mkdtemp(join(tmpdir(), "lfsci-raster-"));
  const file = join(dir, "input.pdf");
  try {
    await writeFile(file, pdf);
    const pages: ExtractPage[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      let jpeg: Buffer;
      try {
        jpeg = await renderOnePage(file, page, maxEdgePx);
      } catch (error) {
        if (page === 1) throw error;
        break;
      }
      if (jpeg.length === 0) break;
      pages.push({ base64: jpeg.toString("base64"), mediaType: "image/jpeg" });
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export const DocumentAnalyzeData = JobBase.extend({
  organizationId: z.uuid(),
  documentVersionId: z.uuid(),
  // `inboxIntent` is the qualification pass: a capture whose nature is not known
  // yet gets a proposed kind and links instead of a schema it may not fit.
  kind: z.enum(["receipt", "invoice", "attestation", "lease", "meterPhoto", "inboxIntent"]),
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

/**
 * Ollama reads page images, not PDF bytes. A rasterisation failure degrades to
 * the OCR text the job already has rather than failing and burning its retries.
 */
export async function rasteriseForModel(
  render: PageRenderer,
  pdf: Uint8Array,
): Promise<{ pages: ExtractPage[]; degraded: string | null }> {
  try {
    const pages = await render({ pdf, maxPages: MAX_PDF_PAGES, maxEdgePx: MAX_PAGE_EDGE });
    if (pages.length === 0) return { pages, degraded: "renderer produced no page" };
    return { pages, degraded: null };
  } catch (error) {
    return { pages: [], degraded: error instanceof Error ? error.message : String(error) };
  }
}

export async function analyzeDocument(
  deps: Deps,
  data: DocumentAnalyzeData,
  render: PageRenderer = popplerRenderer,
): Promise<JobOutcome> {
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
  // The hash on the row came from the uploader; this is the first server-side
  // read of the bytes, and it happens before any paid call.
  const digest = createHash("sha256").update(raw).digest("hex");
  if (digest !== version.sha256) {
    throw new AppError("RULE_VIOLATION", {
      message: "empreinte du fichier différente de celle enregistrée : analyse refusée",
      details: { documentVersionId: data.documentVersionId, expected: version.sha256, digest },
    });
  }

  const sniffed = sniffContentType(raw);
  if (!sniffed) throw new AppError("UNSUPPORTED_MEDIA", { details: { key: version.storageKey } });

  const isPdf = sniffed === "application/pdf";
  const bytes = isPdf ? raw : await normalizeImage(raw);
  const contentType = isPdf ? sniffed : "image/jpeg";

  const ocrResult = await ocr.ocrDocument({ bytes, contentType });
  const ocrText = ocrResult.pages.map((page) => page.markdown).join("\n\n");

  // The Anthropic providers read a PDF natively; the local route needs page images.
  const rasterise = isPdf && ai.provider === "ollama";
  const rastered = rasterise
    ? await rasteriseForModel(render, bytes)
    : { pages: [] as ExtractPage[], degraded: null };
  if (rastered.degraded) {
    log.warn(
      { documentVersionId: data.documentVersionId, reason: rastered.degraded },
      "pdf rasterisation failed, falling back to the ocr text",
    );
  }

  const extraction = await extractDocument(ai, {
    kind: data.kind as DocumentKind,
    ocrText,
    ...(rastered.pages.length > 0 ? { pages: rastered.pages } : {}),
    ...(isPdf && !rasterise ? { pdfBase64: Buffer.from(bytes).toString("base64") } : {}),
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
          provider: ai.provider,
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
    rasterisedPages: rastered.pages.length,
    rasterisationDegraded: rastered.degraded,
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
