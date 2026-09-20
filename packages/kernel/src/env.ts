import { z } from "zod";

/** A blank value in `.env` is the documented way to leave a key unset, so it reads as absent. */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") out[key] = value;
  }
  return out;
}

export function parseEnv<T extends z.ZodRawShape>(
  shape: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(withoutBlanks(source));
  if (!result.success) {
    const missing = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${missing}`);
  }
  return result.data;
}

export const optionalString = z.string().trim().min(1).optional();
export const requiredString = z.string().trim().min(1);
export const url = z.url();
export const port = z.coerce.number().int().min(1).max(65535);
