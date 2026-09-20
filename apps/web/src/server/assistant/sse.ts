import type { AssistantEvent as EngineEvent } from "@lfsci/ai";
import type { api, ErrorPayload } from "@lfsci/contracts";

export type WireEvent = api.assistant.AssistantEvent;
export type WireSource = api.assistant.AssistantSource;

const TOOL_NAMES = [
  "get_action_required",
  "summarize_object",
  "search_memory",
  "explain_amount",
  "propose_command",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

function toolName(name: string): ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name) ? (name as ToolName) : "search_memory";
}

const STOP_REASONS = ["end_turn", "max_tokens", "tool_use", "refusal"] as const;

function stopReason(value: string | null): (typeof STOP_REASONS)[number] {
  return (STOP_REASONS as readonly string[]).includes(value ?? "")
    ? (value as (typeof STOP_REASONS)[number])
    : "end_turn";
}

/** One SSE frame per contract event; the client parses each `data:` line as JSON. */
export function encodeEvent(event: WireEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function errorEvent(payload: ErrorPayload): WireEvent {
  return { type: "error", error: payload };
}

export type EventMapper = {
  /** null when the engine event carries nothing the wire contract expresses. */
  map(event: EngineEvent): WireEvent | null;
  addSources(sources: WireSource[]): void;
  setProposedCommand(commandId: string | null): void;
};

/**
 * The engine reports tool calls by id; sources and the proposed command id come
 * from the ports, so the mapper holds what the last tool produced.
 */
export function createEventMapper(): EventMapper {
  let sources: WireSource[] = [];
  let proposedCommandId: string | null = null;

  return {
    addSources(next) {
      sources = [...sources, ...next];
    },
    setProposedCommand(commandId) {
      proposedCommandId = commandId;
    },
    map(event) {
      switch (event.type) {
        case "text_delta":
          return { type: "text_delta", text: event.text };
        case "tool_call":
          return {
            type: "tool_call",
            toolCallId: event.toolUseId,
            name: toolName(event.name),
            input: {},
          };
        case "tool_result":
          return {
            type: "tool_result",
            toolCallId: event.toolUseId,
            sources,
            proposedCommandId,
          };
        case "done":
          return { type: "done", stopReason: stopReason(event.stopReason), sources };
        case "error":
          return {
            type: "error",
            error: { code: event.code, message: event.message, requestId: event.requestId },
          };
        default:
          return null;
      }
    },
  };
}
