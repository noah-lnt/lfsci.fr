import { z } from "zod";

export function parseEnv<T extends z.ZodRawShape>(
  shape: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(source);
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
