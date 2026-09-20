import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_EFFORT,
  type AssistantEvent,
  type AssistantPorts,
  runAssistantTurn,
} from "../src/assistant";
import { type AiConfig, createAiClient } from "../src/client";
import { fakeToolRunnerClient, textDelta, toolUseStart } from "./fakes";

const bedrockConfig: AiConfig = {
  AI_PROVIDER: "bedrock",
  AI_MODEL: "claude-opus-5",
  AWS_REGION: "eu-west-3",
};

function ports() {
  return {
    getActionRequired: vi.fn(async () => ({
      items: [],
      controlsComplete: true,
      unavailableSources: [],
      sources: [{ id: "ctrl-1", kind: "control", asOf: "2026-09-20" }],
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

describe("runAssistantTurn", () => {
  it("emits events in order, prepares a command and never executes one", async () => {
    const { client, calls } = fakeToolRunnerClient([
      {
        events: [textDelta("Je regarde."), toolUseStart("propose_command", "tu_1")],
        final: {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "propose_command",
              input: {},
            } as Anthropic.Beta.BetaContentBlock,
          ],
        },
        runTool: {
          name: "propose_command",
          id: "tu_1",
          input: {
            kind: "rent_reminder",
            summary: "Relancer le locataire du lot 3",
            objectType: "lease",
            objectId: "lease-1",
          },
        },
      },
      { events: [textDelta("Commande préparée.")], final: { stop_reason: "end_turn" } },
    ]);

    const ai = createAiClient(bedrockConfig, client);
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

    const call = calls[0];
    expect(call?.output_config?.effort).toBe(ASSISTANT_EFFORT);
    expect(call?.max_tokens).toBe(64000);
    expect(call?.stream).toBe(true);
    const system = call?.system as Anthropic.TextBlockParam[];
    expect(system[0]?.cache_control).toEqual({ type: "ephemeral" });
    for (const tool of call?.tools ?? []) {
      expect((tool as { eager_input_streaming?: boolean }).eager_input_streaming).toBe(true);
    }
    // Bedrock: no server-side fallbacks.
    expect(call).not.toHaveProperty("fallbacks");
  });

  it("declares no tool able to execute anything", async () => {
    const { client, calls } = fakeToolRunnerClient([
      { events: [], final: { stop_reason: "end_turn" } },
    ]);
    const ai = createAiClient(bedrockConfig, client);
    await runAssistantTurn({
      ai,
      ports: ports() as unknown as AssistantPorts,
      history: [],
      userMessage: "bonjour",
      organizationId: "org-1",
      onEvent: () => {},
    });
    const names = (calls[0]?.tools ?? []).map((tool) => (tool as { name: string }).name);
    expect(names).toEqual([
      "get_action_required",
      "summarize_object",
      "search_memory",
      "explain_amount",
      "propose_command",
    ]);
  });

  it("aborts on a refusal stop reason with an error event", async () => {
    const { client } = fakeToolRunnerClient([
      {
        events: [],
        final: {
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "cyber", explanation: "refus" },
        } as Partial<Anthropic.Beta.BetaMessage>,
      },
      { events: [textDelta("jamais atteint")], final: { stop_reason: "end_turn" } },
    ]);
    const ai = createAiClient(bedrockConfig, client);
    const events: AssistantEvent[] = [];
    const result = await runAssistantTurn({
      ai,
      ports: ports() as unknown as AssistantPorts,
      history: [],
      userMessage: "…",
      organizationId: "org-1",
      onEvent: (event) => events.push(event),
    });

    expect(result.ok).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    const [event] = events;
    if (event?.type !== "error") throw new Error("expected an error event");
    expect(event.code).toBe("UPSTREAM_REJECTED");
    expect(event.requestId).toBeTruthy();
  });

  it("aborts when max_tokens truncates a pending tool call", async () => {
    const { client } = fakeToolRunnerClient([
      {
        events: [toolUseStart("search_memory", "tu_9")],
        final: {
          stop_reason: "max_tokens",
          content: [
            {
              type: "tool_use",
              id: "tu_9",
              name: "search_memory",
              input: {},
            } as Anthropic.Beta.BetaContentBlock,
          ],
        },
      },
    ]);
    const ai = createAiClient(bedrockConfig, client);
    const events: AssistantEvent[] = [];
    const result = await runAssistantTurn({
      ai,
      ports: ports() as unknown as AssistantPorts,
      history: [],
      userMessage: "…",
      organizationId: "org-1",
      onEvent: (event) => events.push(event),
    });
    expect(result.ok).toBe(false);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("resumes a paused turn by pushing the assistant message back", async () => {
    const { client, pushed } = fakeToolRunnerClient([
      { events: [], final: { stop_reason: "pause_turn", content: [] } },
      { events: [textDelta("suite")], final: { stop_reason: "end_turn" } },
    ]);
    const ai = createAiClient(bedrockConfig, client);
    const result = await runAssistantTurn({
      ai,
      ports: ports() as unknown as AssistantPorts,
      history: [],
      userMessage: "…",
      organizationId: "org-1",
      onEvent: () => {},
    });
    expect(result.ok).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.role).toBe("assistant");
  });

  it("sets server-side fallbacks on the first-party API only", async () => {
    const { client, calls } = fakeToolRunnerClient([
      { events: [], final: { stop_reason: "end_turn" } },
    ]);
    const ai = createAiClient(
      {
        AI_PROVIDER: "anthropic",
        AI_MODEL: "claude-opus-5",
        ANTHROPIC_API_KEY: "k",
        AWS_REGION: "eu-west-3",
      },
      client,
    );
    await runAssistantTurn({
      ai,
      ports: ports() as unknown as AssistantPorts,
      history: [],
      userMessage: "…",
      organizationId: "org-1",
      onEvent: () => {},
    });
    expect((calls[0] as { fallbacks?: unknown }).fallbacks).toBe("default");
    expect((calls[0] as { betas?: string[] }).betas).toEqual(["server-side-fallback-2026-07-01"]);
  });
});
