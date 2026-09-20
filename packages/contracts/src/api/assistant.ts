import { z } from "zod";
import { ObjectRef } from "../entities";
import { ErrorPayload } from "../errors";
import { IsoDateTime, Uuid } from "../primitives";

/** UX-06: the assistant proposes commands; nothing executes inside the loop. */
export const AssistantTurnInput = z.strictObject({
  conversationId: Uuid,
  requestId: Uuid,
  message: z.string().min(1).max(8000),
  context: z.array(ObjectRef).max(10).optional(),
});
export type AssistantTurnInput = z.infer<typeof AssistantTurnInput>;

export const AssistantSource = z.object({
  label: z.string(),
  object: ObjectRef,
  freshnessAt: IsoDateTime.nullable(),
});
export type AssistantSource = z.infer<typeof AssistantSource>;

export const AssistantEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    toolCallId: z.string(),
    name: z.enum([
      "get_action_required",
      "summarize_object",
      "search_memory",
      "explain_amount",
      "propose_command",
    ]),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string(),
    sources: z.array(AssistantSource),
    proposedCommandId: Uuid.nullable(),
  }),
  z.object({
    type: z.literal("done"),
    stopReason: z.enum(["end_turn", "max_tokens", "tool_use", "refusal"]),
    sources: z.array(AssistantSource),
  }),
  z.object({ type: z.literal("error"), error: ErrorPayload }),
]);
export type AssistantEvent = z.infer<typeof AssistantEvent>;

export const assistantTurn = { input: AssistantTurnInput, output: AssistantEvent };
