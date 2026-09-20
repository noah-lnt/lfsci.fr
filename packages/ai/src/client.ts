import { parseEnv } from "@lfsci/kernel";
import { z } from "zod";
import {
  AiProvider,
  type AiProviderClient,
  type ExtractStructuredInput,
  type ExtractStructuredResult,
  type RunToolLoopInput,
  type RunToolLoopResult,
} from "./provider";
import { type AiSdkClient, createAnthropicProvider } from "./providers/anthropic";
import {
  checkOllama,
  createOllamaProvider,
  type FetchLike,
  type OllamaHealth,
} from "./providers/ollama";

export const DEFAULT_MODEL = "claude-opus-5";
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
/** The owner's box runs a 32 GB RTX 5090: both defaults fit in VRAM at Q4. */
export const DEFAULT_OLLAMA_MODEL_TEXT = "qwen3:32b";
export const DEFAULT_OLLAMA_MODEL_VISION = "qwen3.5:27b";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;

export const aiEnvShape = {
  AI_PROVIDER: AiProvider.default("ollama"),
  AI_MODEL: z.string().trim().min(1).default(DEFAULT_MODEL),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  AWS_REGION: z.string().trim().min(1).default("eu-west-3"),
  OLLAMA_BASE_URL: z.string().trim().min(1).default(DEFAULT_OLLAMA_BASE_URL),
  OLLAMA_MODEL_TEXT: z.string().trim().min(1).default(DEFAULT_OLLAMA_MODEL_TEXT),
  OLLAMA_MODEL_VISION: z.string().trim().min(1).default(DEFAULT_OLLAMA_MODEL_VISION),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_OLLAMA_TIMEOUT_MS),
  OLLAMA_API_KEY: z.string().trim().min(1).optional(),
};

export const AiConfig = z.object(aiEnvShape);
export type AiConfig = z.infer<typeof AiConfig>;
export type AiConfigInput = z.input<typeof AiConfig>;

export function aiConfigFromEnv(source: NodeJS.ProcessEnv = process.env): AiConfig {
  return parseEnv(aiEnvShape, source);
}

export type AiClient = {
  provider: AiProvider;
  modelId: string;
  supportsServerSideFallback: boolean;
  extract(input: ExtractStructuredInput): Promise<ExtractStructuredResult>;
  assistant(input: RunToolLoopInput): Promise<RunToolLoopResult>;
  health(): Promise<OllamaHealth | null>;
};

export function createAiClient(
  input: AiConfigInput,
  injected?: AiSdkClient,
  fetchImpl?: FetchLike,
): AiClient {
  const config = AiConfig.parse(input);
  const provider: AiProviderClient =
    config.AI_PROVIDER === "ollama"
      ? createOllamaProvider({
          baseUrl: config.OLLAMA_BASE_URL,
          modelText: config.OLLAMA_MODEL_TEXT,
          modelVision: config.OLLAMA_MODEL_VISION,
          timeoutMs: config.OLLAMA_TIMEOUT_MS,
          apiKey: config.OLLAMA_API_KEY,
          fetchImpl,
        })
      : createAnthropicProvider(
          {
            provider: config.AI_PROVIDER,
            model: config.AI_MODEL,
            apiKey: config.ANTHROPIC_API_KEY,
            awsRegion: config.AWS_REGION,
          },
          injected,
        );

  return {
    provider: provider.provider,
    modelId: provider.modelId,
    supportsServerSideFallback: provider.supportsServerSideFallback,
    extract: (extractInput) => provider.extractStructured(extractInput),
    assistant: (loopInput) => provider.runToolLoop(loopInput),
    health: async () =>
      config.AI_PROVIDER === "ollama"
        ? checkOllama({
            baseUrl: config.OLLAMA_BASE_URL,
            modelText: config.OLLAMA_MODEL_TEXT,
            modelVision: config.OLLAMA_MODEL_VISION,
            apiKey: config.OLLAMA_API_KEY,
            fetchImpl,
          })
        : null,
  };
}

/** True when the selected provider has everything it needs; never a network call. */
export function isConfigured(config: AiConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.AI_PROVIDER === "ollama") return config.OLLAMA_BASE_URL.length > 0;
  if (config.AI_PROVIDER === "anthropic") return Boolean(config.ANTHROPIC_API_KEY);
  return Boolean(
    env.AWS_ACCESS_KEY_ID ||
      env.AWS_PROFILE ||
      env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      env.AWS_WEB_IDENTITY_TOKEN_FILE,
  );
}
