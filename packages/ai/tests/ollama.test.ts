import { describe, expect, it, vi } from "vitest";
import { type AssistantPorts, runAssistantTurn } from "../src/assistant";
import { type AiConfigInput, createAiClient } from "../src/client";
import { extractDocument } from "../src/extract";
import type { AssistantEvent } from "../src/provider";
import { checkOllama, splitNdjson } from "../src/providers/ollama";
import { chatDone, fakeFetch } from "./ollamaFakes";

const ollamaConfig: AiConfigInput = {
  AI_PROVIDER: "ollama",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL_TEXT: "qwen3:32b",
  OLLAMA_MODEL_VISION: "qwen3.5:27b",
};

function field<T>(value: T) {
  return { value, evidence: null, confidence: 0.9 };
}

const receipt = {
  supplier: field("Boulangerie Dupont"),
  date: field("2026-09-12"),
  totalInclTax: field("2.40"),
  totalExclTax: field("2.27"),
  tax: field("0.13"),
  lines: [{ description: field("2 baguettes"), amount: field("2.40") }],
  paymentMethodHint: field("CB"),
};

describe("ollama extraction request shape", () => {
  it("sends the Zod schema as `format`, temperature 0 and the text model", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { kind: "json", body: chatDone(JSON.stringify(receipt)) },
    ]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "TOTAL 2,40" });

    expect(result.ok).toBe(true);
    const call = calls[0];
    expect(call?.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(call?.body?.model).toBe("qwen3:32b");
    expect(call?.body?.stream).toBe(false);
    expect(call?.body?.think).toBe(false);
    expect(call?.body?.options).toMatchObject({ temperature: 0 });
    const format = call?.body?.format as { type: string; properties: Record<string, unknown> };
    expect(format.type).toBe("object");
    expect(Object.keys(format.properties)).toContain("totalInclTax");
    expect(JSON.stringify(format)).not.toContain("$ref");
  });

  it("switches to the vision model and puts pages in `images` when a page is sent", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { kind: "json", body: chatDone(JSON.stringify(receipt)) },
    ]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    await extractDocument(ai, {
      kind: "receipt",
      ocrText: "TOTAL 2,40",
      pages: [{ pngBase64: "iVBORw0=" }],
    });

    const body = calls[0]?.body as { model: string; messages: { images?: string[] }[] };
    expect(body.model).toBe("qwen3.5:27b");
    expect(body.messages[1]?.images).toEqual(["iVBORw0="]);
  });

  it("sends OLLAMA_API_KEY as a bearer token when set", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { kind: "json", body: chatDone(JSON.stringify(receipt)) },
    ]);
    const ai = createAiClient(
      { ...ollamaConfig, OLLAMA_API_KEY: "proxy-key" },
      undefined,
      fetchImpl,
    );
    await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(calls[0]?.headers.authorization).toBe("Bearer proxy-key");
  });

  it("redacts IBANs before the text reaches the model", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { kind: "json", body: chatDone(JSON.stringify(receipt)) },
    ]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    await extractDocument(ai, {
      kind: "invoice",
      ocrText: "Virement FR7630006000011234567890189 le 2026-09-01",
    });
    const body = calls[0]?.body as { messages: { content: string }[] };
    expect(body.messages[1]?.content).not.toContain("FR7630006000011234567890189");
  });
});

describe("ollama extraction failures", () => {
  it("returns parse_failed when the output is not JSON", async () => {
    const { fetchImpl } = fakeFetch([{ kind: "json", body: chatDone("je ne sais pas") }]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("parse_failed");
    expect(result).not.toHaveProperty("output");
  });

  it("returns parse_failed, never a fabricated field, when the JSON violates the schema", async () => {
    const broken = { ...receipt, totalInclTax: field("deux euros quarante") };
    const { fetchImpl } = fakeFetch([{ kind: "json", body: chatDone(JSON.stringify(broken)) }]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("parse_failed");
    expect(result.detail).toContain("totalInclTax");
  });

  it("maps a refused connection to UPSTREAM_UNAVAILABLE", async () => {
    const { fetchImpl } = fakeFetch([
      { kind: "throw", error: new TypeError("fetch failed: ECONNREFUSED") },
    ]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("maps a missing model to UPSTREAM_REJECTED", async () => {
    const { fetchImpl } = fakeFetch([
      { kind: "json", status: 404, body: { error: "model 'qwen3:32b' not found" } },
    ]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const result = await extractDocument(ai, { kind: "receipt", ocrText: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UPSTREAM_REJECTED");
    expect(result.detail).toContain("not installed");
  });

  it("refuses PDF bytes: Ollama reads page images", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { kind: "json", body: chatDone(JSON.stringify(receipt)) },
    ]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const result = await extractDocument(ai, {
      kind: "receipt",
      ocrText: "x",
      pdfBase64: "JVBERi0=",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_input");
    expect(result.code).toBe("UNSUPPORTED_MEDIA");
    expect(calls).toHaveLength(0);
  });
});

function ports() {
  return {
    getActionRequired: vi.fn(async () => ({
      items: [],
      controlsComplete: true,
      unavailableSources: [],
      sources: [],
    })),
    summarizeObject: vi.fn(async () => ({ summary: "", sources: [] })),
    searchMemory: vi.fn(async () => ({ results: [], corpusComplete: true, sources: [] })),
    explainAmount: vi.fn(async () => ({
      amount: "0.00",
      currency: "EUR",
      breakdown: [],
      sources: [],
    })),
    prepareCommand: vi.fn(async () => ({ commandId: "cmd-1", status: "prepared" as const })),
    executeCommand: vi.fn(async () => {
      throw new Error("the assistant must never execute a command");
    }),
  };
}

describe("ollama tool loop", () => {
  it("runs the tool, answers as role tool, then streams the final text", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        kind: "ndjson",
        chunks: [
          [{ message: { role: "assistant", content: "Je regarde." } }],
          [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    function: {
                      name: "propose_command",
                      arguments: {
                        kind: "rent_reminder",
                        summary: "Relancer le locataire du lot 3",
                        objectType: "lease",
                        objectId: "lease-1",
                      },
                    },
                  },
                ],
              },
            },
            { done: true, done_reason: "stop" },
          ],
        ],
      },
      {
        kind: "ndjson",
        chunks: [
          [{ message: { content: "Commande " } }, { message: { content: "préparée." } }],
          [{ done: true, done_reason: "stop" }],
        ],
      },
    ]);

    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const events: AssistantEvent[] = [];
    const p = ports();
    const result = await runAssistantTurn({
      ai,
      ports: p as unknown as AssistantPorts,
      history: [],
      userMessage: "Relance le locataire du lot 3",
      organizationId: "org-1",
      onEvent: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "text_delta",
      "tool_call",
      "tool_result",
      "text_delta",
      "text_delta",
      "done",
    ]);
    expect(p.prepareCommand).toHaveBeenCalledWith({
      organizationId: "org-1",
      kind: "rent_reminder",
      summary: "Relancer le locataire du lot 3",
      objectType: "lease",
      objectId: "lease-1",
    });
    expect(p.executeCommand).not.toHaveBeenCalled();

    const second = calls[1]?.body as { messages: { role: string; tool_name?: string }[] };
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_name: "propose_command" });
    const first = calls[0]?.body as { tools: { function: { name: string } }[] };
    const tools = first.tools;
    expect(tools.map((tool) => tool.function.name)).toEqual([
      "get_action_required",
      "summarize_object",
      "search_memory",
      "explain_amount",
      "propose_command",
    ]);
  });

  it("emits one error event when the instance is unreachable", async () => {
    const { fetchImpl } = fakeFetch([{ kind: "throw", error: new TypeError("fetch failed") }]);
    const ai = createAiClient(ollamaConfig, undefined, fetchImpl);
    const events: AssistantEvent[] = [];
    const result = await runAssistantTurn({
      ai,
      ports: ports() as unknown as AssistantPorts,
      history: [],
      userMessage: "bonjour",
      organizationId: "org-1",
      onEvent: (event) => events.push(event),
    });
    expect(result.ok).toBe(false);
    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type !== "error") throw new Error("expected an error event");
    expect(event.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(event.requestId).toBeTruthy();
  });
});

describe("NDJSON framing", () => {
  it("keeps a half-received line for the next read", () => {
    const first = splitNdjson('{"a":1}\n{"b":');
    expect(first.lines).toEqual(['{"a":1}']);
    expect(first.rest).toBe('{"b":');
    expect(splitNdjson(`${first.rest}2}\n`).lines).toEqual(['{"b":2}']);
  });
});

describe("checkOllama", () => {
  it("reports the configured models that are not installed", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { kind: "json", body: { models: [{ model: "qwen3:32b", name: "qwen3:32b" }] } },
    ]);
    const health = await checkOllama({
      baseUrl: "http://127.0.0.1:11434",
      modelText: "qwen3:32b",
      modelVision: "qwen3.5:27b",
      fetchImpl,
    });
    expect(calls[0]?.url).toBe("http://127.0.0.1:11434/api/tags");
    expect(health.reachable).toBe(true);
    expect(health.installed).toEqual(["qwen3:32b"]);
    expect(health.missing).toEqual(["qwen3.5:27b"]);
  });

  it("reports unreachable instead of throwing", async () => {
    const { fetchImpl } = fakeFetch([{ kind: "throw", error: new TypeError("fetch failed") }]);
    const health = await checkOllama({
      baseUrl: "http://127.0.0.1:11434",
      modelText: "qwen3:32b",
      modelVision: "qwen3.5:27b",
      fetchImpl,
    });
    expect(health.reachable).toBe(false);
    expect(health.missing).toEqual(["qwen3:32b", "qwen3.5:27b"]);
  });
});
