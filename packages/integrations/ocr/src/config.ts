import { parseEnv, requiredString } from "@lfsci/kernel";
import { z } from "zod";

// Mistral OCR, verified 2026-09-19: model alias mistral-ocr-latest, $4 per 1 000 pages.
export const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
export const MISTRAL_DEFAULT_BASE_URL = "https://api.mistral.ai";
export const MISTRAL_OCR_PATH = "/v1/ocr";
export const MISTRAL_OCR_PRICE_PER_1000_PAGES_USD = 4;

export const OcrConfig = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.url().default(MISTRAL_DEFAULT_BASE_URL),
  model: z.string().min(1).default(MISTRAL_OCR_MODEL),
  timeoutMs: z.number().int().positive().default(120_000),
});
export type OcrConfig = z.infer<typeof OcrConfig>;

export function ocrConfigFromEnv(source: NodeJS.ProcessEnv = process.env): OcrConfig {
  const env = parseEnv(
    {
      MISTRAL_API_KEY: requiredString,
      MISTRAL_BASE_URL: z.url().default(MISTRAL_DEFAULT_BASE_URL),
      MISTRAL_OCR_MODEL: z.string().min(1).default(MISTRAL_OCR_MODEL),
      MISTRAL_OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    },
    source,
  );
  return OcrConfig.parse({
    apiKey: env.MISTRAL_API_KEY,
    baseUrl: env.MISTRAL_BASE_URL,
    model: env.MISTRAL_OCR_MODEL,
    timeoutMs: env.MISTRAL_OCR_TIMEOUT_MS,
  });
}
