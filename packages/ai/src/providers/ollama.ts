/**
 * Ollama HTTP API, verified 2026-09-20 against
 * https://github.com/ollama/ollama/blob/main/docs/api.md and a live 11434 instance.
 * POST /api/chat takes `model`, `messages[{role,content,images[],tool_calls[],tool_name}]`,
 * `tools[{type:"function",function:{name,description,parameters}}]`, `format` (a JSON schema
 * object), `stream`, `think`, `options.temperature`, `options.num_predict`.
 * A response carries `message.content`, `message.tool_calls[].function.{name,arguments}`,
 * `done`, `done_reason`, `prompt_eval_count`, `eval_count`; streaming is NDJSON, one JSON
 * object per line. A tool answer goes back as `{role:"tool",tool_name,content}`.
 * An unknown model is HTTP 404 with `{"error":"model '<name>' not found"}`.
 * GET /api/tags lists installed models as `models[].{name,model,capabilities[]}`.
 */
import type { ErrorCode } from "@lfsci/contracts";
import { AppError } from "@lfsci/kernel";
import { z } from "zod";
import {
  type AiProviderClient,
  type ExtractStructuredResult,
  jsonSchemaOf,
  type ProviderTool,
  type RunToolLoopResult,
} from "../provider";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type OllamaProviderConfig = {
  baseUrl: string;
  modelText: string;
  modelVision: string;
  timeoutMs: number;
  apiKey?: string | undefined;
  fetchImpl?: FetchLike | undefined;
};

type OllamaToolCall = { function: { name: string; arguments: unknown } };

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};

type OllamaChunk = {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

export type OllamaHealth = {
  reachable: boolean;
  installed: string[];
  missing: string[];
  detail: string | null;
};

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function headers(apiKey: string | undefined): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

function toolsPayload(tools: ProviderTool[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchemaOf(tool.inputSchema, "input"),
    },
  }));
}

/** NDJSON: one `data` chunk is not one message, and a half line must wait for the next read. */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim().length > 0), rest };
}

export function createOllamaProvider(config: OllamaProviderConfig): AiProviderClient {
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));

  async function post(body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(endpoint(config.baseUrl, "/api/chat"), {
        method: "POST",
        headers: headers(config.apiKey),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        details: { reason: "ollama unreachable", baseUrl: config.baseUrl },
        cause: error,
      });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const model = (body as { model?: string }).model ?? null;
      const missingModel = response.status === 404 && text.includes("not found");
      throw new AppError(missingModel ? "UPSTREAM_REJECTED" : "UPSTREAM_UNAVAILABLE", {
        message: missingModel ? "ollama model not installed" : "ollama request failed",
        details: { status: response.status, model, body: text.slice(0, 300) },
      });
    }
    return response;
  }

  function extractFailure(error: unknown): ExtractStructuredResult {
    const code: ErrorCode = error instanceof AppError ? error.code : "INTERNAL";
    return {
      ok: false,
      reason: "upstream",
      code,
      upstreamRequestId: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    provider: "ollama",
    modelId: config.modelText,
    supportsServerSideFallback: false,

    async extractStructured(input) {
      if (input.pdfBase64) {
        return {
          ok: false,
          reason: "unsupported_input",
          code: "UNSUPPORTED_MEDIA",
          upstreamRequestId: null,
          detail: "ollama reads page images, not PDF bytes: rasterise the pages first",
        };
      }

      const images = input.images ?? [];
      const model = images.length > 0 ? config.modelVision : config.modelText;
      const user: OllamaMessage = {
        role: "user",
        content: input.userText,
        ...(images.length > 0 ? { images: images.map((image) => image.base64) } : {}),
      };

      let chunk: OllamaChunk;
      try {
        const response = await post({
          model,
          messages: [{ role: "system", content: input.system }, user],
          format: jsonSchemaOf(input.schema, "output"),
          stream: false,
          think: false,
          options: { temperature: 0, num_predict: input.maxTokens },
        });
        chunk = (await response.json()) as OllamaChunk;
      } catch (error) {
        return extractFailure(error);
      }

      const content = chunk.message?.content ?? "";
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        return {
          ok: false,
          reason: "parse_failed",
          code: "UPSTREAM_REJECTED",
          upstreamRequestId: null,
          detail: "model output is not JSON",
        };
      }

      return {
        ok: true,
        output: json,
        modelId: model,
        usage: {
          inputTokens: chunk.prompt_eval_count ?? null,
          outputTokens: chunk.eval_count ?? null,
        },
      };
    },

    async runToolLoop(input): Promise<RunToolLoopResult> {
      const byName = new Map(input.tools.map((tool) => [tool.name, tool]));
      const messages: OllamaMessage[] = [
        { role: "system", content: input.system },
        ...input.messages.map((message) => ({ role: message.role, content: message.content })),
      ];

      let stopReason: string | null = null;

      for (let turn = 0; turn < input.maxTurns; turn += 1) {
        const response = await post({
          model: config.modelText,
          messages,
          tools: toolsPayload(input.tools),
          stream: true,
          think: false,
          options: { temperature: 0, num_predict: input.maxTokens },
        });

        const calls: OllamaToolCall[] = [];
        let text = "";
        let buffer = "";
        const decoder = new TextDecoder();
        const body = response.body;
        if (!body) {
          throw new AppError("UPSTREAM_UNAVAILABLE", { message: "ollama returned no stream" });
        }

        const handleLine = (line: string): void => {
          let chunk: OllamaChunk;
          try {
            chunk = JSON.parse(line) as OllamaChunk;
          } catch {
            return;
          }
          const delta = chunk.message?.content ?? "";
          if (delta) {
            text += delta;
            input.onEvent({ type: "text_delta", text: delta });
          }
          for (const call of chunk.message?.tool_calls ?? []) calls.push(call);
          if (chunk.done) stopReason = chunk.done_reason ?? "stop";
        };

        for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(bytes, { stream: true });
          const split = splitNdjson(buffer);
          buffer = split.rest;
          for (const line of split.lines) handleLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim().length > 0) handleLine(buffer);

        if (calls.length === 0) {
          input.onEvent({ type: "done", stopReason: stopReason ?? "end_turn" });
          return { ok: true, stopReason: stopReason ?? "end_turn" };
        }

        messages.push({ role: "assistant", content: text, tool_calls: calls });

        for (const [index, call] of calls.entries()) {
          const name = call.function.name;
          const toolUseId = `call_${turn}_${index}`;
          input.onEvent({ type: "tool_call", name, toolUseId });
          const tool = byName.get(name);
          if (!tool) {
            input.onEvent({ type: "tool_result", name, toolUseId });
            messages.push({ role: "tool", tool_name: name, content: `{"error":"unknown tool"}` });
            continue;
          }
          try {
            const answer = await tool.run(call.function.arguments, toolUseId);
            messages.push({ role: "tool", tool_name: name, content: answer });
          } catch (error) {
            if (!(error instanceof z.ZodError)) throw error;
            input.onEvent({ type: "tool_result", name, toolUseId });
            messages.push({
              role: "tool",
              tool_name: name,
              content: JSON.stringify({ error: "invalid tool arguments" }),
            });
          }
        }
      }

      input.onEvent({
        type: "error",
        code: "UPSTREAM_REJECTED",
        message: `the assistant reached ${input.maxTurns} tool turns without answering`,
        requestId: input.requestId,
      });
      return { ok: false, stopReason: "max_turns" };
    },
  };
}

/** Boot never probes the network; health and /readyz call this explicitly. */
export async function checkOllama(
  config: Pick<OllamaProviderConfig, "baseUrl" | "modelText" | "modelVision" | "apiKey"> & {
    fetchImpl?: FetchLike | undefined;
    timeoutMs?: number | undefined;
  },
): Promise<OllamaHealth> {
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));
  const wanted = [config.modelText, config.modelVision];
  try {
    const response = await doFetch(endpoint(config.baseUrl, "/api/tags"), {
      headers: headers(config.apiKey),
      signal: AbortSignal.timeout(config.timeoutMs ?? 5_000),
    });
    if (!response.ok) {
      return {
        reachable: false,
        installed: [],
        missing: wanted,
        detail: `HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
    const installed = (body.models ?? []).map((entry) => entry.model ?? entry.name ?? "");
    return {
      reachable: true,
      installed,
      missing: wanted.filter((model) => !installed.includes(model)),
      detail: null,
    };
  } catch (error) {
    return {
      reachable: false,
      installed: [],
      missing: wanted,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
