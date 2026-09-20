import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type { ErrorCode } from "@lfsci/contracts";
import { currentRequestId } from "@lfsci/kernel";
import { z } from "zod";
import type { AiClient } from "./client";
import { SERVER_SIDE_FALLBACK_BETA } from "./client";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompts/assistant";
import { redactForModel } from "./redaction";

export const ASSISTANT_MAX_TOKENS = 64000;
export const ASSISTANT_EFFORT = "medium" as const;
export const ASSISTANT_PROMPT_VERSION = PROMPT_VERSION;

/** Every tool answer carries where it came from and how fresh it is (MEM-02). */
export type ToolSource = { id: string; kind: string; asOf: string };

export type ActionRequiredResult = {
  items: { id: string; label: string; dueOn: string | null }[];
  controlsComplete: boolean;
  unavailableSources: string[];
  sources: ToolSource[];
};

export type ObjectSummaryResult = { summary: string; sources: ToolSource[] };

export type MemorySearchResult = {
  results: { id: string; kind: string; excerpt: string; asOf: string }[];
  corpusComplete: boolean;
  sources: ToolSource[];
};

export type AmountExplanationResult = {
  amount: string;
  currency: string;
  breakdown: { label: string; amount: string; sourceId: string }[];
  sources: ToolSource[];
};

export type PreparedCommand = { commandId: string; status: "prepared" };

/**
 * Implemented by the web app, which applies the caller's rights BEFORE retrieval
 * and re-checks them on the rows it returns (MEM-01). No method here executes anything.
 */
export interface AssistantPorts {
  getActionRequired(input: {
    organizationId: string;
    scope: string | null;
  }): Promise<ActionRequiredResult>;
  summarizeObject(input: {
    organizationId: string;
    objectType: string;
    objectId: string;
  }): Promise<ObjectSummaryResult>;
  searchMemory(input: {
    organizationId: string;
    query: string;
    limit: number;
  }): Promise<MemorySearchResult>;
  explainAmount(input: {
    organizationId: string;
    objectType: string;
    objectId: string;
    label: string;
  }): Promise<AmountExplanationResult>;
  prepareCommand(input: {
    organizationId: string;
    kind: string;
    summary: string;
    objectType: string;
    objectId: string;
  }): Promise<PreparedCommand>;
}

export type AssistantEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; toolUseId: string }
  | { type: "tool_result"; name: string; toolUseId: string }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; code: ErrorCode; message: string; requestId: string };

export type AssistantTurnResult = {
  ok: boolean;
  stopReason: string | null;
  promptVersion: string;
  modelId: string;
};

export type RunAssistantTurnInput = {
  ai: AiClient;
  ports: AssistantPorts;
  history: Anthropic.Beta.BetaMessageParam[];
  userMessage: string;
  organizationId: string;
  onEvent: (event: AssistantEvent) => void;
};

function toolUseIdOf(context: { toolUse: { id: string } } | undefined): string {
  return context?.toolUse.id ?? "";
}

function buildTools(
  ports: AssistantPorts,
  organizationId: string,
  onEvent: (event: AssistantEvent) => void,
): BetaRunnableTool[] {
  const answer = (name: string, toolUseId: string, payload: unknown): string => {
    onEvent({ type: "tool_result", name, toolUseId });
    return JSON.stringify(payload);
  };

  const tools = [
    betaZodTool({
      name: "get_action_required",
      description:
        "Ce qui attend le gérant aujourd'hui, avec l'état des contrôles nocturnes et les sources indisponibles.",
      inputSchema: z.object({ scope: z.string().max(120).nullable() }),
      run: async (args, context) =>
        answer(
          "get_action_required",
          toolUseIdOf(context),
          await ports.getActionRequired({ organizationId, scope: args.scope }),
        ),
    }),
    betaZodTool({
      name: "summarize_object",
      description: "Résumé sourcé d'un objet (lot, bail, immeuble, personne, chantier).",
      inputSchema: z.object({
        objectType: z.string().max(60),
        objectId: z.string().max(80),
      }),
      run: async (args, context) =>
        answer(
          "summarize_object",
          toolUseIdOf(context),
          await ports.summarizeObject({ organizationId, ...args }),
        ),
    }),
    betaZodTool({
      name: "search_memory",
      description:
        "Recherche autorisée dans documents, activités, événements et interventions. Les droits sont appliqués avant la récupération.",
      inputSchema: z.object({
        query: z.string().max(400),
        limit: z.number().int().min(1).max(50),
      }),
      run: async (args, context) =>
        answer(
          "search_memory",
          toolUseIdOf(context),
          await ports.searchMemory({ organizationId, ...args }),
        ),
    }),
    betaZodTool({
      name: "explain_amount",
      description:
        "Décomposition déterministe d'un montant affiché, avec la pièce ou l'écriture derrière chaque ligne.",
      inputSchema: z.object({
        objectType: z.string().max(60),
        objectId: z.string().max(80),
        label: z.string().max(120),
      }),
      run: async (args, context) =>
        answer(
          "explain_amount",
          toolUseIdOf(context),
          await ports.explainAmount({ organizationId, ...args }),
        ),
    }),
    betaZodTool({
      name: "propose_command",
      description:
        "Prépare une commande soumise à l'approbation du gérant. N'exécute rien et ne notifie personne.",
      inputSchema: z.object({
        kind: z.string().max(80),
        summary: z.string().max(400),
        objectType: z.string().max(60),
        objectId: z.string().max(80),
      }),
      run: async (args, context) => {
        const prepared = await ports.prepareCommand({ organizationId, ...args });
        return answer("propose_command", toolUseIdOf(context), {
          commandId: prepared.commandId,
          status: "prepared",
        });
      },
    }),
  ];

  return tools.map((tool) => ({ ...tool, eager_input_streaming: true }));
}

function hasToolUse(message: Anthropic.Beta.BetaMessage): boolean {
  return message.content.some((block) => block.type === "tool_use");
}

export async function runAssistantTurn(input: RunAssistantTurnInput): Promise<AssistantTurnResult> {
  const { ai, ports, history, userMessage, organizationId, onEvent } = input;
  const requestId = currentRequestId();
  const fail = (code: ErrorCode, message: string, stopReason: string | null) => {
    onEvent({ type: "error", code, message, requestId });
    return { ok: false, stopReason, promptVersion: PROMPT_VERSION, modelId: ai.modelId };
  };

  const params: BetaToolRunnerParams & { stream: true } = {
    model: ai.modelId,
    max_tokens: ASSISTANT_MAX_TOKENS,
    stream: true,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    output_config: { effort: ASSISTANT_EFFORT },
    tools: buildTools(ports, organizationId, onEvent),
    messages: [...history, { role: "user", content: redactForModel(userMessage) }],
    ...(ai.supportsServerSideFallback
      ? { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: "default" as const }
      : {}),
  };

  const runner = ai.client.beta.messages.toolRunner(params);
  let stopReason: string | null = null;

  for await (const messageStream of runner) {
    for await (const event of messageStream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onEvent({ type: "text_delta", text: event.delta.text });
      }
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        onEvent({
          type: "tool_call",
          name: event.content_block.name,
          toolUseId: event.content_block.id,
        });
      }
    }

    const message = await messageStream.finalMessage();
    stopReason = message.stop_reason;

    if (message.stop_reason === "refusal") {
      return fail("UPSTREAM_REJECTED", message.stop_details?.explanation ?? "refusal", stopReason);
    }
    if (message.stop_reason === "max_tokens" && hasToolUse(message)) {
      return fail("UPSTREAM_REJECTED", "max_tokens reached with a pending tool call", stopReason);
    }
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  onEvent({ type: "done", stopReason });
  return { ok: true, stopReason, promptVersion: PROMPT_VERSION, modelId: ai.modelId };
}
