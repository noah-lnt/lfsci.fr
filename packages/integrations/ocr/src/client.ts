import { AppError, logger } from "@lfsci/kernel";
import type { OcrConfig } from "./config";
import { MISTRAL_OCR_PATH } from "./config";
import {
  type FetchLike,
  mapHttpFailure,
  mapTransportFailure,
  parseUpstream,
  readBody,
} from "./http";
import { OcrResponse, type OcrResult } from "./schema";

const SERVICE = "mistral-ocr";
const log = logger(SERVICE);

const documentTypes = new Set(["application/pdf"]);
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/heic"]);

export type OcrRequest = {
  bytes: Uint8Array;
  contentType: string;
  includeImageBase64?: boolean;
  pages?: number[];
};

export type OcrClient = { ocrDocument(request: OcrRequest): Promise<OcrResult> };

function documentPayload(request: OcrRequest): Record<string, unknown> {
  const base64 = Buffer.from(request.bytes).toString("base64");
  const dataUrl = `data:${request.contentType};base64,${base64}`;
  if (documentTypes.has(request.contentType)) {
    return { type: "document_url", document_url: dataUrl };
  }
  if (imageTypes.has(request.contentType)) {
    return { type: "image_url", image_url: dataUrl };
  }
  throw new AppError("UNSUPPORTED_MEDIA", { details: { contentType: request.contentType } });
}

export function createOcrClient(input: { config: OcrConfig; fetch?: FetchLike }): OcrClient {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;

  return {
    async ocrDocument(request) {
      if (request.bytes.length === 0) {
        throw new AppError("VALIDATION", { message: "empty document" });
      }
      const body = {
        model: config.model,
        document: documentPayload(request),
        include_image_base64: request.includeImageBase64 ?? false,
        ...(request.pages ? { pages: request.pages } : {}),
      };

      let response: Response;
      try {
        response = await doFetch(`${config.baseUrl}${MISTRAL_OCR_PATH}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (cause) {
        throw mapTransportFailure({ service: SERVICE, idempotent: true, cause });
      }

      if (!response.ok) {
        throw mapHttpFailure({
          service: SERVICE,
          status: response.status,
          body: await readBody(response),
        });
      }

      const parsed = parseUpstream(OcrResponse, await response.json(), SERVICE);
      log.debug({ pages: parsed.pages.length, model: parsed.model }, "ocr completed");
      return {
        pages: parsed.pages,
        model: parsed.model,
        usage: {
          pagesProcessed: parsed.usage_info?.pages_processed ?? parsed.pages.length,
          documentSizeBytes: parsed.usage_info?.doc_size_bytes ?? undefined,
        },
      };
    },
  };
}
