export type OllamaCall = {
  url: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
};

export type CannedResponse =
  | { kind: "json"; status?: number; body: unknown }
  | { kind: "ndjson"; chunks: unknown[][] }
  | { kind: "throw"; error: Error };

export function fakeFetch(responses: CannedResponse[]): {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  calls: OllamaCall[];
} {
  const calls: OllamaCall[] = [];
  let index = 0;

  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === "string" ? init.body : null;
    calls.push({
      url: input,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const canned = responses[Math.min(index++, responses.length - 1)];
    if (!canned) throw new Error("no canned response");
    if (canned.kind === "throw") throw canned.error;
    if (canned.kind === "json") {
      return new Response(JSON.stringify(canned.body), {
        status: canned.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const group of canned.chunks) {
          controller.enqueue(
            encoder.encode(group.map((line) => `${JSON.stringify(line)}\n`).join("")),
          );
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };

  return { fetchImpl, calls };
}

export function chatDone(content: string, extra: Record<string, unknown> = {}): unknown {
  return {
    model: "qwen3:32b",
    message: { role: "assistant", content },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 42,
    eval_count: 7,
    ...extra,
  };
}
