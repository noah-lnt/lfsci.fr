import { AppError, currentRequestId } from "@lfsci/kernel";
import { z } from "zod";
import type { AiClient } from "./client";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompts/assistant";
import { type AiMessage, type AssistantEvent, type ProviderTool, providerTool } from "./provider";
import { redactForModel } from "./redaction";

export const ASSISTANT_MAX_TOKENS = 64000;
export const ASSISTANT_EFFORT = "medium" as const;
export const ASSISTANT_MAX_TURNS = 8;
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

export type AssistantTurnResult = {
  ok: boolean;
  stopReason: string | null;
  promptVersion: string;
  modelId: string;
};

export type RunAssistantTurnInput = {
  ai: AiClient;
  ports: AssistantPorts;
  history: AiMessage[];
  userMessage: string;
  organizationId: string;
  onEvent: (event: AssistantEvent) => void;
};

function buildTools(
  ports: AssistantPorts,
  organizationId: string,
  onEvent: (event: AssistantEvent) => void,
): ProviderTool[] {
  const answer = (name: string, toolUseId: string, payload: unknown): string => {
    onEvent({ type: "tool_result", name, toolUseId });
    return JSON.stringify(payload);
  };

  return [
    providerTool({
      name: "get_action_required",
      description:
        "Ce qui attend le gérant aujourd'hui, avec l'état des contrôles nocturnes et les sources indisponibles.",
      inputSchema: z.object({ scope: z.string().max(120).nullable() }),
      run: async (args, toolUseId) =>
        answer(
          "get_action_required",
          toolUseId,
          await ports.getActionRequired({ organizationId, scope: args.scope }),
        ),
    }),
    providerTool({
      name: "summarize_object",
      description: "Résumé sourcé d'un objet (lot, bail, immeuble, personne, chantier).",
      inputSchema: z.object({
        objectType: z.string().max(60),
        objectId: z.string().max(80),
      }),
      run: async (args, toolUseId) =>
        answer(
          "summarize_object",
          toolUseId,
          await ports.summarizeObject({ organizationId, ...args }),
        ),
    }),
    providerTool({
      name: "search_memory",
      description:
        "Recherche autorisée dans documents, activités, événements et interventions. Les droits sont appliqués avant la récupération.",
      inputSchema: z.object({
        query: z.string().max(400),
        limit: z.number().int().min(1).max(50),
      }),
      run: async (args, toolUseId) =>
        answer("search_memory", toolUseId, await ports.searchMemory({ organizationId, ...args })),
    }),
    providerTool({
      name: "explain_amount",
      description:
        "Décomposition déterministe d'un montant affiché, avec la pièce ou l'écriture derrière chaque ligne.",
      inputSchema: z.object({
        objectType: z.string().max(60),
        objectId: z.string().max(80),
        label: z.string().max(120),
      }),
      run: async (args, toolUseId) =>
        answer("explain_amount", toolUseId, await ports.explainAmount({ organizationId, ...args })),
    }),
    providerTool({
      name: "propose_command",
      description:
        "Prépare une commande soumise à l'approbation du gérant. N'exécute rien et ne notifie personne.",
      inputSchema: z.object({
        kind: z.string().max(80),
        summary: z.string().max(400),
        objectType: z.string().max(60),
        objectId: z.string().max(80),
      }),
      run: async (args, toolUseId) => {
        const prepared = await ports.prepareCommand({ organizationId, ...args });
        return answer("propose_command", toolUseId, {
          commandId: prepared.commandId,
          status: "prepared",
        });
      },
    }),
  ];
}

export async function runAssistantTurn(input: RunAssistantTurnInput): Promise<AssistantTurnResult> {
  const { ai, ports, history, userMessage, organizationId, onEvent } = input;
  const requestId = currentRequestId();

  try {
    const result = await ai.assistant({
      system: SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: redactForModel(userMessage) }],
      tools: buildTools(ports, organizationId, onEvent),
      onEvent,
      maxTurns: ASSISTANT_MAX_TURNS,
      maxTokens: ASSISTANT_MAX_TOKENS,
      requestId,
      effort: ASSISTANT_EFFORT,
    });
    return {
      ok: result.ok,
      stopReason: result.stopReason,
      promptVersion: PROMPT_VERSION,
      modelId: ai.modelId,
    };
  } catch (error) {
    const appError = error instanceof AppError ? error : null;
    onEvent({
      type: "error",
      code: appError?.code ?? "UPSTREAM_UNAVAILABLE",
      message: appError?.message ?? "assistant turn failed",
      requestId,
    });
    return { ok: false, stopReason: null, promptVersion: PROMPT_VERSION, modelId: ai.modelId };
  }
}
