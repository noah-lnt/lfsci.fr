import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { ParsedMessage } from "@anthropic-ai/sdk";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import { AppError, parseEnv } from "@lfsci/kernel";
import { z } from "zod";

export const AiProvider = z.enum(["bedrock", "anthropic"]);
export type AiProvider = z.infer<typeof AiProvider>;

export const DEFAULT_MODEL = "claude-opus-5";
export const BEDROCK_MODEL_PREFIX = "anthropic.";
export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const aiEnvShape = {
  AI_PROVIDER: AiProvider.default("bedrock"),
  AI_MODEL: z.string().trim().min(1).default(DEFAULT_MODEL),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  AWS_REGION: z.string().trim().min(1).default("eu-west-3"),
};

export const AiConfig = z.object(aiEnvShape);
export type AiConfig = z.infer<typeof AiConfig>;

export function aiConfigFromEnv(source: NodeJS.ProcessEnv = process.env): AiConfig {
  return parseEnv(aiEnvShape, source);
}

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

export type AiClient = {
  client: AiSdkClient;
  modelId: string;
  provider: AiProvider;
  /** Server-side refusal fallbacks exist on the first-party API only, never on Bedrock. */
  supportsServerSideFallback: boolean;
};

export function bedrockModelId(model: string): string {
  return model.startsWith(BEDROCK_MODEL_PREFIX) ? model : `${BEDROCK_MODEL_PREFIX}${model}`;
}

export function createAiClient(config: AiConfig, injected?: AiSdkClient): AiClient {
  if (config.AI_PROVIDER === "bedrock") {
    const client = injected ?? new AnthropicBedrockMantle({ awsRegion: config.AWS_REGION });
    return {
      client,
      modelId: bedrockModelId(config.AI_MODEL),
      provider: "bedrock",
      supportsServerSideFallback: false,
    };
  }

  const apiKey = config.ANTHROPIC_API_KEY;
  if (!injected && !apiKey) {
    throw new AppError("INTERNAL", {
      message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic",
    });
  }

  const client = injected ?? new Anthropic({ apiKey });
  return {
    client,
    modelId: config.AI_MODEL,
    provider: "anthropic",
    supportsServerSideFallback: true,
  };
}
