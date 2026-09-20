import { extractDocument } from "@lfsci/ai";
import { tables, withTenant } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { defineJob, type JobOutcome } from "./registry";

export const VoiceTranscribeData = JobBase.extend({
  organizationId: z.uuid(),
  activityId: z.uuid(),
  storageKey: z.string().min(1),
  filename: z.string().min(1).default("note.webm"),
  contentType: z.string().min(1).default("audio/webm"),
  inboxItemId: z.uuid().optional(),
});
export type VoiceTranscribeData = z.infer<typeof VoiceTranscribeData>;

export async function transcribeVoiceNote(
  deps: Deps,
  data: VoiceTranscribeData,
): Promise<JobOutcome> {
  const missing: string[] = [];
  if (!deps.storage) missing.push("storage");
  if (!deps.speech) missing.push("speech");
  if (missing.length > 0) return { outcome: "sources_unavailable", missing };
  const storage = deps.storage;
  const speech = deps.speech;
  if (!storage || !speech) return { outcome: "sources_unavailable", missing };

  const url = await storage.presignDownload({ key: data.storageKey });
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      message: "voice note download failed",
      details: { status: response.status },
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  const transcription = await speech.transcribe({
    bytes,
    filename: data.filename,
    contentType: data.contentType,
  });

  await withTenant(deps.db, { organizationId: data.organizationId }, (tx) =>
    tx
      .update(tables.activity)
      .set({ bodyRaw: transcription.transcript, updatedAt: new Date().toISOString() })
      .where(eq(tables.activity.id, data.activityId)),
  );

  if (!deps.ai) {
    return {
      outcome: "transcribed",
      intent: "sources_unavailable",
      chars: transcription.transcript.length,
    };
  }

  const intent = await extractDocument(deps.ai, {
    kind: "inboxIntent",
    ocrText: transcription.transcript,
  });
  if (!intent.ok) {
    return { outcome: "transcribed", intent: "extraction_failed", reason: intent.reason };
  }

  await withTenant(deps.db, { organizationId: data.organizationId }, (tx) =>
    tx.insert(tables.aiExtraction).values({
      organizationId: data.organizationId,
      sourceActivityId: data.activityId,
      inboxItemId: data.inboxItemId ?? null,
      fieldPath: "intent",
      proposedValueJson: intent.output as Record<string, unknown>,
      provider: "anthropic",
      modelName: intent.modelId,
      promptVersion: intent.promptVersion,
      decision: "pending" as const,
      autonomyLevel: "A",
    }),
  );

  return { outcome: "transcribed", intent: "extracted", chars: transcription.transcript.length };
}

export const voiceTranscribe = defineJob({
  name: "voice.transcribe",
  schema: VoiceTranscribeData,
  options: {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 1800,
    expireInSeconds: 900,
    localConcurrency: 1,
  },
  handler: (data, deps) => transcribeVoiceNote(deps, data),
});
