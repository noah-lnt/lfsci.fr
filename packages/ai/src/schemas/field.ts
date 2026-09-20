import { z } from "zod";

export const Evidence = z.object({
  page: z.number().int().positive().nullable(),
  bbox: z.array(z.number()).length(4).nullable(),
  quote: z.string().max(400).nullable(),
});
export type Evidence = z.infer<typeof Evidence>;

export function field<T extends z.ZodType>(schema: T) {
  return z.object({
    value: schema.nullable(),
    evidence: Evidence.nullable(),
    confidence: z.number().min(0).max(1),
  });
}

export type Field<T> = {
  value: T | null;
  evidence: Evidence | null;
  confidence: number;
};
