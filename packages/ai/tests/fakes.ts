import type Anthropic from "@anthropic-ai/sdk";
import type { ParsedMessage } from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type { AiSdkClient, AssistantMessageStream, AssistantRunner } from "../src/client";

export const usage = {
  input_tokens: 10,
  output_tokens: 20,
  cache_creation: null,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  inference_geo: null,
} as unknown as Anthropic.Usage;

export function parsedMessage(
  parsedOutput: unknown,
  overrides: Partial<Anthropic.Message> = {},
): ParsedMessage<unknown> {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage,
    parsed_output: parsedOutput,
    ...overrides,
  } as unknown as ParsedMessage<unknown>;
}

export type ParseCall = Anthropic.MessageCreateParamsNonStreaming;

export function fakeParseClient(responses: (ParsedMessage<unknown> | Error)[]): {
  client: AiSdkClient;
  calls: ParseCall[];
} {
  const calls: ParseCall[] = [];
  let index = 0;
  const client: AiSdkClient = {
    messages: {
      parse: async (params) => {
        calls.push(params);
        const response = responses[Math.min(index++, responses.length - 1)];
        if (response instanceof Error) throw response;
        if (!response) throw new Error("no canned response");
        return response;
      },
    },
    beta: {
      messages: {
        toolRunner: () => {
          throw new Error("toolRunner not expected in this test");
        },
      },
    },
  };
  return { client, calls };
}

export type ScriptStep = {
  events: Anthropic.Beta.BetaRawMessageStreamEvent[];
  final: Partial<Anthropic.Beta.BetaMessage>;
  runTool?: { name: string; id: string; input: unknown };
};

function betaMessage(partial: Partial<Anthropic.Beta.BetaMessage>): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage,
    ...partial,
  } as unknown as Anthropic.Beta.BetaMessage;
}

function fakeStream(step: ScriptStep): AssistantMessageStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of step.events) yield event;
    },
    finalMessage: async () => betaMessage(step.final),
  };
}

export function fakeToolRunnerClient(script: ScriptStep[]): {
  client: AiSdkClient;
  calls: BetaToolRunnerParams[];
  pushed: Anthropic.Beta.BetaMessageParam[];
} {
  const calls: BetaToolRunnerParams[] = [];
  const pushed: Anthropic.Beta.BetaMessageParam[] = [];

  const client: AiSdkClient = {
    messages: {
      parse: () => {
        throw new Error("parse not expected in this test");
      },
    },
    beta: {
      messages: {
        toolRunner: (body) => {
          calls.push(body);
          const runner: AssistantRunner = {
            async *[Symbol.asyncIterator]() {
              for (const step of script) {
                yield fakeStream(step);
                if (step.runTool) {
                  const tool = body.tools.find(
                    (candidate): candidate is BetaRunnableTool =>
                      "run" in candidate && candidate.name === step.runTool?.name,
                  );
                  if (!tool) throw new Error(`tool not declared: ${step.runTool.name}`);
                  await tool.run(tool.parse(step.runTool.input), {
                    toolUse: {
                      type: "tool_use",
                      id: step.runTool.id,
                      name: step.runTool.name,
                      input: step.runTool.input,
                    } as Anthropic.Beta.BetaToolUseBlock,
                    toolUseBlock: {
                      type: "tool_use",
                      id: step.runTool.id,
                      name: step.runTool.name,
                      input: step.runTool.input,
                    } as Anthropic.Beta.BetaToolUseBlock,
                  });
                }
              }
            },
            pushMessages: (...messages) => {
              pushed.push(...messages);
            },
          };
          return runner;
        },
      },
    },
  };

  return { client, calls, pushed };
}

export function textDelta(text: string): Anthropic.Beta.BetaRawMessageStreamEvent {
  return {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  } as Anthropic.Beta.BetaRawMessageStreamEvent;
}

export function toolUseStart(name: string, id: string): Anthropic.Beta.BetaRawMessageStreamEvent {
  return {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id, name, input: {} },
  } as Anthropic.Beta.BetaRawMessageStreamEvent;
}
