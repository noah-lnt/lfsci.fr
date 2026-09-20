import { AppError, logger } from "@lfsci/kernel";
import type { SpeechConfig } from "./config";
import { GLADIA_API_KEY_HEADER, GLADIA_PRERECORDED_PATH, GLADIA_UPLOAD_PATH } from "./config";
import {
  type FetchLike,
  mapHttpFailure,
  mapTransportFailure,
  parseUpstream,
  readBody,
} from "./http";
import { InitResponse, ResultResponse, type Transcription, UploadResponse } from "./schema";

const SERVICE = "gladia";
const log = logger(SERVICE);

export type Sleep = (ms: number) => Promise<void>;

export type TranscribeRequest = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  language?: string;
  diarization?: boolean;
};

export type SpeechClient = {
  upload(request: Pick<TranscribeRequest, "bytes" | "filename" | "contentType">): Promise<string>;
  transcribe(request: TranscribeRequest): Promise<Transcription>;
};

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSpeechClient(input: {
  config: SpeechConfig;
  fetch?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
}): SpeechClient {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const authHeaders = { [GLADIA_API_KEY_HEADER]: config.apiKey };

  async function call(url: string, init: RequestInit, idempotent: boolean): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (cause) {
      throw mapTransportFailure({ service: SERVICE, idempotent, cause });
    }
    if (!response.ok) {
      throw mapHttpFailure({
        service: SERVICE,
        status: response.status,
        body: await readBody(response),
      });
    }
    return response.json();
  }

  const client: SpeechClient = {
    async upload({ bytes, filename, contentType }) {
      if (bytes.length === 0) throw new AppError("VALIDATION", { message: "empty audio" });
      const form = new FormData();
      form.append("audio", new Blob([bytes], { type: contentType }), filename);
      const body = await call(
        `${config.baseUrl}${GLADIA_UPLOAD_PATH}`,
        { method: "POST", headers: authHeaders, body: form },
        false,
      );
      return parseUpstream(UploadResponse, body, SERVICE).audio_url;
    },

    async transcribe(request) {
      const audioUrl = await client.upload(request);
      const language = request.language ?? config.language;
      const init = parseUpstream(
        InitResponse,
        await call(
          `${config.baseUrl}${GLADIA_PRERECORDED_PATH}`,
          {
            method: "POST",
            headers: { ...authHeaders, "content-type": "application/json" },
            body: JSON.stringify({
              audio_url: audioUrl,
              // language_config is the documented field; a bare `language` is not accepted (v2 reference).
              language_config: { languages: [language], code_switching: false },
              ...(request.diarization ? { diarization: true } : {}),
            }),
          },
          false,
        ),
        SERVICE,
      );

      const deadline = now() + config.maxWaitMs;
      for (;;) {
        const result = parseUpstream(
          ResultResponse,
          await call(init.result_url, { method: "GET", headers: authHeaders }, true),
          SERVICE,
        );
        if (result.status === "error") {
          throw new AppError("UPSTREAM_REJECTED", {
            message: "gladia could not transcribe this audio",
            details: { id: init.id, errorCode: result.error_code ?? null },
          });
        }
        if (result.status === "done") {
          const transcription = result.result?.transcription;
          if (!transcription) {
            throw new AppError("UPSTREAM_REJECTED", {
              message: "gladia reported done without a transcription",
              details: { id: init.id },
            });
          }
          log.debug({ id: init.id }, "transcription done");
          return {
            transcript: transcription.full_transcript,
            language: transcription.languages?.[0] ?? language,
            durationSeconds: result.result?.metadata?.audio_duration ?? 0,
            utterances: transcription.utterances,
          };
        }
        if (now() >= deadline) {
          throw new AppError("RESULT_UNKNOWN", {
            message: "gladia transcription still running past the maximum wait",
            details: { id: init.id, maxWaitMs: config.maxWaitMs },
          });
        }
        await sleep(config.pollIntervalMs);
      }
    },
  };

  return client;
}
