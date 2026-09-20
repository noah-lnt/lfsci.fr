import type { ErrorCode } from "@lfsci/contracts";
import { z } from "zod";

export const AiProvider = z.enum(["ollama", "anthropic", "bedrock"]);
export type AiProvider = z.infer<typeof AiProvider>;

/** Reasoning budget on the Anthropic route; other providers ignore it. */
export type AiEffort = "low" | "medium" | "high";

export type AiUsage = { inputTokens: number | null; outputTokens: number | null };

export type ProviderImage = { mediaType: string; base64: string };

export type ExtractStructuredInput = {
  system: string;
  userText: string;
  images?: ProviderImage[];
  pdfBase64?: string;
  schema: z.ZodType;
  maxTokens: number;
  requestId: string;
  effort?: AiEffort;
};

export type ExtractFailureReason = "parse_failed" | "refusal" | "upstream" | "unsupported_input";

export type EmbedInput = { texts: string[]; requestId: string };

export type EmbedFailureReason = "unsupported" | "upstream" | "dimension_mismatch";

/**
 * `dimension_mismatch` is a refusal, never a repair: `embedding.vector` is
 * `vector(1024)` in migration 0001, and a truncated or padded vector would sit
 * in the HNSW index looking valid while ranking against a different space.
 */
export type EmbedResult =
  | { ok: true; vectors: number[][]; modelId: string; dimensions: number; usage: AiUsage }
  | { ok: false; reason: EmbedFailureReason; code: ErrorCode; detail: string };

export type ExtractStructuredResult =
  | { ok: true; output: unknown; usage: AiUsage; modelId: string }
  | {
      ok: false;
      reason: ExtractFailureReason;
      code: ErrorCode;
      detail: string;
      upstreamRequestId: string | null;
    };

export type AssistantEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; toolUseId: string }
  | { type: "tool_result"; name: string; toolUseId: string }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; code: ErrorCode; message: string; requestId: string };

export type AiMessage = { role: "user" | "assistant"; content: string };

export type ProviderTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  run: (args: unknown, toolCallId: string) => Promise<string>;
};

/** Validates the model's arguments once, wherever the provider got them from. */
export function providerTool<S extends z.ZodObject>(definition: {
  name: string;
  description: string;
  inputSchema: S;
  run: (args: z.infer<S>, toolCallId: string) => Promise<string>;
}): ProviderTool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    run: (args, toolCallId) => definition.run(definition.inputSchema.parse(args), toolCallId),
  };
}

export type RunToolLoopInput = {
  system: string;
  messages: AiMessage[];
  tools: ProviderTool[];
  onEvent: (event: AssistantEvent) => void;
  maxTurns: number;
  maxTokens: number;
  requestId: string;
  effort?: AiEffort;
};

export type RunToolLoopResult = { ok: boolean; stopReason: string | null };

export type AiProviderClient = {
  provider: AiProvider;
  modelId: string;
  /** Server-side refusal fallbacks exist on the first-party Anthropic API only. */
  supportsServerSideFallback: boolean;
  extractStructured(input: ExtractStructuredInput): Promise<ExtractStructuredResult>;
  runToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult>;
  embed(input: EmbedInput): Promise<EmbedResult>;
};

export function jsonSchemaOf(schema: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io,
    reused: "inline",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
