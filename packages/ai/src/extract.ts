import type { ErrorCode } from "@lfsci/contracts";
import { currentRequestId } from "@lfsci/kernel";
import type { z } from "zod";
import type { AiClient } from "./client";
import * as attestationPrompt from "./prompts/attestation";
import * as inboxIntentPrompt from "./prompts/inboxIntent";
import * as invoicePrompt from "./prompts/invoice";
import * as leasePrompt from "./prompts/lease";
import * as meterPhotoPrompt from "./prompts/meterPhoto";
import * as receiptPrompt from "./prompts/receipt";
import type { AiUsage, ExtractFailureReason } from "./provider";
import { redactForModel } from "./redaction";
import {
  AttestationExtraction,
  InboxIntentExtraction,
  InvoiceExtraction,
  LeaseExtraction,
  MeterPhotoExtraction,
  ReceiptExtraction,
} from "./schemas/documents";
import type { Field } from "./schemas/field";

export const EXTRACTION_MAX_TOKENS = 16000;
export const EXTRACTION_EFFORT = "high" as const;

const registry = {
  receipt: { schema: ReceiptExtraction, prompt: receiptPrompt },
  invoice: { schema: InvoiceExtraction, prompt: invoicePrompt },
  attestation: { schema: AttestationExtraction, prompt: attestationPrompt },
  lease: { schema: LeaseExtraction, prompt: leasePrompt },
  meterPhoto: { schema: MeterPhotoExtraction, prompt: meterPhotoPrompt },
  inboxIntent: { schema: InboxIntentExtraction, prompt: inboxIntentPrompt },
} as const;

export type DocumentKind = keyof typeof registry;
export type ExtractionSchema<K extends DocumentKind> = (typeof registry)[K]["schema"];
export type ExtractionOutput<K extends DocumentKind> = z.infer<ExtractionSchema<K>>;

export function promptVersionFor(kind: DocumentKind): string {
  return registry[kind].prompt.PROMPT_VERSION;
}

export type ExtractionChecks = { totalsConsistent: boolean };

export type ExtractInput<K extends DocumentKind> = {
  kind: K;
  ocrText: string;
  pages?: { pngBase64: string }[];
  pdfBase64?: string;
  promptVersion?: string;
};

export type ExtractSuccess<K extends DocumentKind> = {
  ok: true;
  output: ExtractionOutput<K>;
  modelId: string;
  promptVersion: string;
  usage: AiUsage;
  checks: ExtractionChecks | null;
};

export type ExtractFailure = {
  ok: false;
  reason: ExtractFailureReason;
  code: ErrorCode;
  requestId: string;
  upstreamRequestId: string | null;
  detail: string;
};

export type ExtractResult<K extends DocumentKind> = ExtractSuccess<K> | ExtractFailure;

function centsOf(amount: string | null): number | null {
  if (amount === null) return null;
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

type WithTotals = {
  lines: { amount: Field<string> }[];
  totalExclTax: Field<string>;
  totalInclTax: Field<string>;
  tax: Field<string>;
};

function hasTotals(kind: DocumentKind): boolean {
  return kind === "receipt" || kind === "invoice";
}

/** Sum of the lines against the declared total (DEP-01); the model never balances it itself. */
export function checkTotals(output: WithTotals): ExtractionChecks | null {
  if (output.lines.length === 0) return null;
  const lineCents: number[] = [];
  for (const line of output.lines) {
    const cents = centsOf(line.amount.value);
    if (cents === null) return null;
    lineCents.push(cents);
  }
  const sum = lineCents.reduce((total, cents) => total + cents, 0);
  const exclTax = centsOf(output.totalExclTax.value);
  const inclTax = centsOf(output.totalInclTax.value);
  const tax = centsOf(output.tax.value);
  const derivedExclTax = inclTax !== null && tax !== null ? inclTax - tax : null;
  const candidates = [exclTax, derivedExclTax, inclTax].filter(
    (value): value is number => value !== null,
  );
  if (candidates.length === 0) return null;
  const tolerance = Math.max(1, lineCents.length);
  return { totalsConsistent: candidates.some((value) => Math.abs(value - sum) <= tolerance) };
}

export async function extractDocument<K extends DocumentKind>(
  ai: AiClient,
  input: ExtractInput<K>,
): Promise<ExtractResult<K>> {
  const { schema, prompt } = registry[input.kind];
  const promptVersion = input.promptVersion ?? prompt.PROMPT_VERSION;
  const requestId = currentRequestId();

  const result = await ai.extract({
    system: prompt.SYSTEM_PROMPT,
    userText: redactForModel(input.ocrText),
    images: (input.pages ?? []).map((page) => ({
      mediaType: "image/png",
      base64: page.pngBase64,
    })),
    ...(input.pdfBase64 ? { pdfBase64: input.pdfBase64 } : {}),
    schema,
    maxTokens: EXTRACTION_MAX_TOKENS,
    requestId,
    effort: EXTRACTION_EFFORT,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      code: result.code,
      requestId,
      upstreamRequestId: result.upstreamRequestId,
      detail: result.detail,
    };
  }

  const parsed = schema.safeParse(result.output);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "parse_failed",
      code: "UPSTREAM_REJECTED",
      requestId,
      upstreamRequestId: null,
      detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(",") || "no output",
    };
  }

  const output = parsed.data as ExtractionOutput<K>;
  return {
    ok: true,
    output,
    modelId: result.modelId,
    promptVersion,
    usage: result.usage,
    checks: hasTotals(input.kind) ? checkTotals(output as unknown as WithTotals) : null,
  };
}
