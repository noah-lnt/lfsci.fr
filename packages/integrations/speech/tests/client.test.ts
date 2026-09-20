import { describe, expect, it } from "vitest";
import { createSpeechClient } from "../src/client";
import { SpeechConfig } from "../src/config";
import type { FetchLike } from "../src/http";

const config = SpeechConfig.parse({ apiKey: "gladia-key", pollIntervalMs: 10, maxWaitMs: 100 });

const audio = { bytes: Uint8Array.from([1, 2, 3]), filename: "note.m4a", contentType: "audio/mp4" };

type Call = { url: string; init: RequestInit };

function scripted(responses: (call: Call) => Response, calls: Call[]): FetchLike {
  return (async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return responses(call);
  }) as FetchLike;
}

const doneBody = {
  status: "done",
  result: {
    metadata: { audio_duration: 12.5 },
    transcription: {
      full_transcript: "Le locataire signale une fuite.",
      languages: ["fr"],
      utterances: [{ text: "Le locataire signale une fuite.", start: 0, end: 12.5 }],
    },
  },
};

describe("transcribe", () => {
  it("uploads, initialises with language_config fr and polls until done", async () => {
    const calls: Call[] = [];
    let polls = 0;
    const client = createSpeechClient({
      config,
      sleep: () => Promise.resolve(),
      fetch: scripted((call) => {
        if (call.url.endsWith("/v2/upload"))
          return Response.json({ audio_url: "https://api.gladia.io/file/a" });
        if (call.url.endsWith("/v2/pre-recorded")) {
          return Response.json({
            id: "job-1",
            result_url: "https://api.gladia.io/v2/pre-recorded/job-1",
          });
        }
        polls += 1;
        return Response.json(polls < 3 ? { status: "processing" } : doneBody);
      }, calls),
    });

    const result = await client.transcribe(audio);

    expect(calls[0]?.url).toBe("https://api.gladia.io/v2/upload");
    expect(((calls[0]?.init.headers ?? {}) as Record<string, string>)["x-gladia-key"]).toBe(
      "gladia-key",
    );
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      audio_url: "https://api.gladia.io/file/a",
      language_config: { languages: ["fr"], code_switching: false },
    });
    expect(polls).toBe(3);
    expect(result).toEqual({
      transcript: "Le locataire signale une fuite.",
      language: "fr",
      durationSeconds: 12.5,
      utterances: [{ text: "Le locataire signale une fuite.", start: 0, end: 12.5 }],
    });
  });

  it("maps a status error to UPSTREAM_REJECTED", async () => {
    const client = createSpeechClient({
      config,
      sleep: () => Promise.resolve(),
      fetch: scripted((call) => {
        if (call.url.endsWith("/v2/upload"))
          return Response.json({ audio_url: "https://api.gladia.io/file/a" });
        if (call.url.endsWith("/v2/pre-recorded")) {
          return Response.json({
            id: "job-1",
            result_url: "https://api.gladia.io/v2/pre-recorded/job-1",
          });
        }
        return Response.json({ status: "error", error_code: 400 });
      }, []),
    });
    await expect(client.transcribe(audio)).rejects.toMatchObject({ code: "UPSTREAM_REJECTED" });
  });

  it("gives up with RESULT_UNKNOWN past the maximum wait", async () => {
    let clock = 0;
    const client = createSpeechClient({
      config,
      now: () => clock,
      sleep: (ms) => {
        clock += ms * 20;
        return Promise.resolve();
      },
      fetch: scripted((call) => {
        if (call.url.endsWith("/v2/upload"))
          return Response.json({ audio_url: "https://api.gladia.io/file/a" });
        if (call.url.endsWith("/v2/pre-recorded")) {
          return Response.json({
            id: "job-1",
            result_url: "https://api.gladia.io/v2/pre-recorded/job-1",
          });
        }
        return Response.json({ status: "processing" });
      }, []),
    });
    await expect(client.transcribe(audio)).rejects.toMatchObject({ code: "RESULT_UNKNOWN" });
  });

  it("maps a timeout on the non-idempotent upload to RESULT_UNKNOWN", async () => {
    const client = createSpeechClient({
      config,
      fetch: (() =>
        Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))) as FetchLike,
    });
    await expect(client.upload(audio)).rejects.toMatchObject({ code: "RESULT_UNKNOWN" });
  });

  it("refuses empty audio before any call", async () => {
    const calls: Call[] = [];
    const client = createSpeechClient({ config, fetch: scripted(() => Response.json({}), calls) });
    await expect(client.upload({ ...audio, bytes: new Uint8Array() })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(calls).toHaveLength(0);
  });
});
