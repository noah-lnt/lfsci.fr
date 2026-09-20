import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { ParsedMessage } from "@anthropic-ai/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type { ErrorCode } from "@lfsci/contracts";
import { AppError } from "@lfsci/kernel";
import type {
  AiProviderClient,
  ExtractStructuredInput,
  ExtractStructuredResult,
  RunToolLoopInput,
  RunToolLoopResult,
} from "../provider";

export const BEDROCK_MODEL_PREFIX = "anthropic.";
export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The slice of the SDK surface this package uses; a test double implements it. */
export type AiSdkClient = {
  messages: {
    parse(params: Anthropic.MessageCreateParamsNonStreaming): Promise<ParsedMessage<unknown>>;
  };
  beta: {
    messages: {
      toolRunner(body: BetaToolRunnerParams & { stream: true }): AssistantRunner;
    };
  };
};

export type AssistantMessageStream = AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent> & {
  finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
};

export type AssistantRunner = AsyncIterable<AssistantMessageStream> & {
  pushMessages(...messages: Anthropic.Beta.BetaMessageParam[]): void;
};

export function bedrockModelId(model: string): string {
  return model.startsWith(BEDROCK_MODEL_PREFIX) ? model : `${BEDROCK_MODEL_PREFIX}${model}`;
}

function userContent(input: ExtractStructuredInput): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (input.pdfBase64) {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 },
    });
  }
  for (const image of input.images ?? []) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType as "image/png",
        data: image.base64,
      },
    });
  }
  blocks.push({ type: "text", text: input.userText });
  return blocks;
}

function failureFromError(error: unknown): ExtractStructuredResult {
  const base = { ok: false as const, reason: "upstream" as const };
  if (error instanceof Anthropic.RateLimitError) {
    return {
      ...base,
      code: "QUOTA_EXCEEDED",
      upstreamRequestId: error.requestID ?? null,
      detail: error.message,
    };
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.BadRequestError
  ) {
    return {
      ...base,
      code: "UPSTREAM_REJECTED",
      upstreamRequestId: error.requestID ?? null,
      detail: error.message,
    };
  }
  if (error instanceof Anthropic.APIError) {
    return {
      ...base,
      code: "UPSTREAM_UNAVAILABLE",
      upstreamRequestId: error.requestID ?? null,
      detail: error.message,
    };
  }
  return {
    ...base,
    code: "INTERNAL",
    upstreamRequestId: null,
    detail: error instanceof Error ? error.message : String(error),
  };
}

function buildTools(tools: RunToolLoopInput["tools"]): BetaRunnableTool[] {
  return tools.map((tool) => ({
    ...betaZodTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      run: async (args, context) => tool.run(args, context?.toolUse.id ?? ""),
    }),
    eager_input_streaming: true,
  }));
}

function hasToolUse(message: Anthropic.Beta.BetaMessage): boolean {
  return message.content.some((block) => block.type === "tool_use");
}

export type AnthropicProviderConfig = {
  provider: "anthropic" | "bedrock";
  model: string;
  apiKey?: string | undefined;
  awsRegion: string;
};

export function createAnthropicProvider(
  config: AnthropicProviderConfig,
  injected?: AiSdkClient,
): AiProviderClient {
  const bedrock = config.provider === "bedrock";
  if (!bedrock && !injected && !config.apiKey) {
    throw new AppError("INTERNAL", {
      message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic",
    });
  }

  const client: AiSdkClient =
    injected ??
    (bedrock
      ? new AnthropicBedrockMantle({ awsRegion: config.awsRegion })
      : new Anthropic({ apiKey: config.apiKey }));
  const modelId = bedrock ? bedrockModelId(config.model) : config.model;

  return {
    provider: config.provider,
    modelId,
    supportsServerSideFallback: !bedrock,

    async extractStructured(input) {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: modelId,
        max_tokens: input.maxTokens,
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        output_config: {
          ...(input.effort ? { effort: input.effort } : {}),
          format: zodOutputFormat(input.schema),
        },
        messages: [{ role: "user", content: userContent(input) }],
      };

      let message: ParsedMessage<unknown>;
      try {
        message = await client.messages.parse(params);
      } catch (error) {
        return failureFromError(error);
      }

      if (message.stop_reason === "refusal") {
        return {
          ok: false,
          reason: "refusal",
          code: "UPSTREAM_REJECTED",
          upstreamRequestId: null,
          detail: message.stop_details?.explanation ?? "refusal",
        };
      }

      return {
        ok: true,
        output: message.parsed_output,
        modelId,
        usage: {
          inputTokens: message.usage?.input_tokens ?? null,
          outputTokens: message.usage?.output_tokens ?? null,
        },
      };
    },

    async runToolLoop(input): Promise<RunToolLoopResult> {
      const fail = (
        code: ErrorCode,
        message: string,
        stopReason: string | null,
      ): RunToolLoopResult => {
        input.onEvent({ type: "error", code, message, requestId: input.requestId });
        return { ok: false, stopReason };
      };

      const params: BetaToolRunnerParams & { stream: true } = {
        model: modelId,
        max_tokens: input.maxTokens,
        stream: true,
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        ...(input.effort ? { output_config: { effort: input.effort } } : {}),
        tools: buildTools(input.tools),
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        ...(bedrock ? {} : { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: "default" as const }),
      };

      const runner = client.beta.messages.toolRunner(params);
      let stopReason: string | null = null;

      for await (const messageStream of runner) {
        for await (const event of messageStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            input.onEvent({ type: "text_delta", text: event.delta.text });
          }
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            input.onEvent({
              type: "tool_call",
              name: event.content_block.name,
              toolUseId: event.content_block.id,
            });
          }
        }

        const message = await messageStream.finalMessage();
        stopReason = message.stop_reason;

        if (message.stop_reason === "refusal") {
          return fail(
            "UPSTREAM_REJECTED",
            message.stop_details?.explanation ?? "refusal",
            stopReason,
          );
        }
        if (message.stop_reason === "max_tokens" && hasToolUse(message)) {
          return fail(
            "UPSTREAM_REJECTED",
            "max_tokens reached with a pending tool call",
            stopReason,
          );
        }
        if (message.stop_reason === "pause_turn") {
          runner.pushMessages({ role: "assistant", content: message.content });
        }
      }

      input.onEvent({ type: "done", stopReason });
      return { ok: true, stopReason };
    },
  };
}
