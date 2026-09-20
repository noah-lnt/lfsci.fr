import { z } from "zod";

export const UploadResponse = z.object({ audio_url: z.url() });

export const InitResponse = z.object({ id: z.string().min(1), result_url: z.url() });

export const Utterance = z.object({
  text: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  confidence: z.number().optional(),
  speaker: z.number().nullable().optional(),
  language: z.string().optional(),
});

export const ResultResponse = z.object({
  id: z.string().optional(),
  status: z.enum(["queued", "processing", "done", "error"]),
  error_code: z.union([z.number(), z.string()]).nullable().optional(),
  result: z
    .object({
      metadata: z.object({ audio_duration: z.number().optional() }).optional(),
      transcription: z
        .object({
          full_transcript: z.string(),
          languages: z.array(z.string()).optional(),
          utterances: z.array(Utterance).optional(),
        })
        .optional(),
    })
    .nullable()
    .optional(),
});

export type Utterance = z.infer<typeof Utterance>;

export type Transcription = {
  transcript: string;
  language: string;
  durationSeconds: number;
  utterances: Utterance[] | undefined;
};
