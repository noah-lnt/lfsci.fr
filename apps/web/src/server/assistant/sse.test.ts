import { api } from "@lfsci/contracts";
import { describe, expect, it } from "vitest";
import { createEventMapper, encodeEvent, errorEvent } from "./sse";

const OBJECT = { kind: "lease" as const, id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" };

function parse(frame: string): unknown {
  return JSON.parse(frame.replace(/^data: /, "").trim());
}

describe("encodeEvent", () => {
  it("writes one SSE frame the client can split on a blank line", () => {
    const frame = encodeEvent({ type: "text_delta", text: "bonjour" });
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(parse(frame)).toEqual({ type: "text_delta", text: "bonjour" });
  });

  it("keeps a newline inside the text out of the frame delimiter", () => {
    const frame = encodeEvent({ type: "text_delta", text: "une\n\nligne" });
    expect(frame.split("\n\n")).toHaveLength(2);
    expect(parse(frame)).toEqual({ type: "text_delta", text: "une\n\nligne" });
  });
});

describe("createEventMapper", () => {
  it("emits only events the wire contract accepts", () => {
    const mapper = createEventMapper();
    const events = [
      mapper.map({ type: "text_delta", text: "a" }),
      mapper.map({ type: "tool_call", name: "search_memory", toolUseId: "t1" }),
      mapper.map({ type: "tool_result", name: "search_memory", toolUseId: "t1" }),
      mapper.map({ type: "done", stopReason: "end_turn" }),
    ];
    for (const event of events) {
      expect(api.assistant.AssistantEvent.safeParse(event).success).toBe(true);
    }
  });

  it("carries the sources the ports collected onto the result and the done frame", () => {
    const mapper = createEventMapper();
    mapper.addSources([{ label: "bail", object: OBJECT, freshnessAt: null }]);
    mapper.setProposedCommand("0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c");

    const result = mapper.map({ type: "tool_result", name: "propose_command", toolUseId: "t1" });
    expect(result).toMatchObject({
      type: "tool_result",
      proposedCommandId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
    });
    const done = mapper.map({ type: "done", stopReason: "tool_use" });
    expect(done).toMatchObject({ type: "done", stopReason: "tool_use" });
  });

  it("falls back to a declared stop reason rather than leaking an unknown one", () => {
    const mapper = createEventMapper();
    expect(mapper.map({ type: "done", stopReason: null })).toMatchObject({
      stopReason: "end_turn",
    });
    expect(mapper.map({ type: "done", stopReason: "pause_turn" })).toMatchObject({
      stopReason: "end_turn",
    });
  });

  it("maps an engine error onto the shared error payload", () => {
    const mapper = createEventMapper();
    const event = mapper.map({
      type: "error",
      code: "UPSTREAM_UNAVAILABLE",
      message: "indisponible",
      requestId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    });
    expect(api.assistant.AssistantEvent.safeParse(event).success).toBe(true);
  });
});

describe("errorEvent", () => {
  it("serialises a degraded answer as a single valid frame", () => {
    const frame = encodeEvent(
      errorEvent({
        code: "UPSTREAM_UNAVAILABLE",
        message: "L’assistant n’est pas configuré.",
        requestId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      }),
    );
    expect(api.assistant.AssistantEvent.safeParse(parse(frame)).success).toBe(true);
  });
});
