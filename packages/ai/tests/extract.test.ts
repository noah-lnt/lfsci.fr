import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { type AiConfigInput, createAiClient } from "../src/client";
import { EXTRACTION_EFFORT, extractDocument, promptVersionFor } from "../src/extract";
import { InboxIntentExtraction } from "../src/schemas/documents";
import { fakeParseClient, parsedMessage } from "./fakes";

const bedrockConfig: AiConfigInput = {
  AI_PROVIDER: "bedrock",
  AI_MODEL: "claude-opus-5",
  AWS_REGION: "eu-west-3",
};

const anthropicConfig: AiConfigInput = {
  AI_PROVIDER: "anthropic",
  AI_MODEL: "claude-opus-5",
  ANTHROPIC_API_KEY: "test-key",
  AWS_REGION: "eu-west-3",
};

function field<T>(value: T) {
  return { value, evidence: null, confidence: 0.9 };
}

function receipt(lines: string[], totals: { excl: string; incl: string; tax: string }) {
  return {
    supplier: field("Fournisseur Test"),
    date: field("2026-09-01"),
    totalInclTax: field(totals.incl),
    totalExclTax: field(totals.excl),
    tax: field(totals.tax),
    lines: lines.map((amount, i) => ({
      description: field(`ligne ${i}`),
      amount: field(amount),
    })),
    paymentMethodHint: field("CB"),
  };
}

describe("extractDocument request shape", () => {
  it("puts the document block before the text block, caches the system prompt and sets the effort", async () => {
    const { client, calls } = fakeParseClient([
      parsedMessage(receipt(["10.00"], { excl: "10.00", incl: "12.00", tax: "2.00" })),
    ]);
    const ai = createAiClient(bedrockConfig, client);

    await extractDocument(ai, {
      kind: "receipt",
      ocrText: "TOTAL 12,00",
      pdfBase64: "JVBERi0=",
      pages: [{ pngBase64: "iVBORw0=" }],
    });

    const call = calls[0];
    expect(call).toBeDefined();
    if (!call) return;

    const content = call.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as Anthropic.ContentBlockParam[];
    expect(blocks.map((block) => block.type)).toEqual(["document", "image", "text"]);

    const system = call.system as Anthropic.TextBlockParam[];
    expect(system[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(call.output_config?.effort).toBe(EXTRACTION_EFFORT);
    expect(call.max_tokens).toBe(16000);
  });

  it("uses the bedrock-prefixed model id, and the bare id on the first-party API", async () => {
    const bedrock = fakeParseClient([parsedMessage(null)]);
    const bedrockAi = createAiClient(bedrockConfig, bedrock.client);
    expect(bedrockAi.modelId).toBe("anthropic.claude-opus-5");
    expect(bedrockAi.supportsServerSideFallback).toBe(false);
    await extractDocument(bedrockAi, { kind: "receipt", ocrText: "x" });
    expect(bedrock.calls[0]?.model).toBe("anthropic.claude-opus-5");

    const first = fakeParseClient([parsedMessage(null)]);
    const firstPartyAi = createAiClient(anthropicConfig, first.client);
    expect(firstPartyAi.modelId).toBe("claude-opus-5");
    expect(firstPartyAi.supportsServerSideFallback).toBe(true);
    await extractDocument(firstPartyAi, { kind: "receipt", ocrText: "x" });
    expect(first.calls[0]?.model).toBe("claude-opus-5");
  });

  it("redacts IBANs and long digit runs from the OCR text", async () => {
    const { client, calls } = fakeParseClient([parsedMessage(null)]);
    const ai = createAiClient(bedrockConfig, client);
    await extractDocument(ai, {
      kind: "invoice",
      ocrText: "Virement FR7630006000011234567890189 ref 12345678901234567 le 2026-09-01",
    });
    const blocks = calls[0]?.messages[0]?.content as Anthropic.ContentBlockParam[] | undefined;
    const text = blocks?.[0];
    const rendered = text?.type === "text" ? text.text : "";
    expect(rendered).not.toContain("FR7630006000011234567890189");
    expect(rendered).not.toContain("12345678901234567");
    expect(rendered).toContain("2026-09-01");
  });
});

describe("extractDocument failures", () => {
  it("returns parse_failed with no fabricated output when parsed_output is null", async () => {
    const { client } = fakeParseClient([parsedMessage(null)]);
    const ai = createAiClient(bedrockConfig, client);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "illisible" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("parse_failed");
    expect(result).not.toHaveProperty("output");
    expect(result.requestId).toBeTruthy();
  });

  it("returns refusal when the model declines", async () => {
    const { client } = fakeParseClient([
      parsedMessage(null, {
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "refus" },
      } as Partial<Anthropic.Message>),
    ]);
    const ai = createAiClient(bedrockConfig, client);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("refusal");
  });

  it("maps a rate limit to QUOTA_EXCEEDED without string matching", async () => {
    const error = new Anthropic.RateLimitError(429, undefined, "slow down", new Headers());
    const { client } = fakeParseClient([error]);
    const ai = createAiClient(bedrockConfig, client);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("upstream");
    expect(result.code).toBe("QUOTA_EXCEEDED");
  });
});

describe("totals cross-check (DEP-01)", () => {
  it("is true when the lines add up to the declared total", async () => {
    const { client } = fakeParseClient([
      parsedMessage(receipt(["10.00", "5.50"], { excl: "15.50", incl: "18.60", tax: "3.10" })),
    ]);
    const ai = createAiClient(bedrockConfig, client);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checks).toEqual({ totalsConsistent: true });
    expect(result.promptVersion).toBe(promptVersionFor("receipt"));
  });

  it("is false when they do not", async () => {
    const { client } = fakeParseClient([
      parsedMessage(receipt(["10.00", "5.50"], { excl: "99.00", incl: "118.80", tax: "19.80" })),
    ]);
    const ai = createAiClient(bedrockConfig, client);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checks).toEqual({ totalsConsistent: false });
  });
});

describe("inboxIntent schema (IA-02)", () => {
  const valid = {
    kind: field("tenant_notice" as const),
    personHint: field("M. Dupont"),
    unitHint: field("Lot 3"),
    leaseHint: field(null),
    whyUncertain: "Le nom du lot est déduit de la signature.",
  };

  it("accepts a well-formed intent", () => {
    expect(InboxIntentExtraction.safeParse(valid).success).toBe(true);
  });

  it("rejects an injected action field", () => {
    const result = InboxIntentExtraction.safeParse({
      ...valid,
      action: { value: "send_email", evidence: null, confidence: 1 },
    });
    expect(result.success).toBe(false);
  });
});
