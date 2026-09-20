import { AppError } from "@lfsci/kernel";
import type { z } from "zod";

export type FetchLike = typeof globalThis.fetch;

export function mapHttpFailure(input: { service: string; status: number; body: string }): AppError {
  const details = { service: input.service, status: input.status, body: input.body.slice(0, 512) };
  if (input.status === 429) return new AppError("QUOTA_EXCEEDED", { details });
  if (input.status === 413) return new AppError("PAYLOAD_TOO_LARGE", { details });
  if (input.status === 408 || input.status >= 500) {
    return new AppError("UPSTREAM_UNAVAILABLE", { details });
  }
  return new AppError("UPSTREAM_REJECTED", { details });
}

export function mapTransportFailure(input: {
  service: string;
  idempotent: boolean;
  cause: unknown;
}): AppError {
  const name = input.cause instanceof Error ? input.cause.name : "";
  const timedOut = name === "AbortError" || name === "TimeoutError";
  const details = { service: input.service };
  if (timedOut && !input.idempotent) {
    return new AppError("RESULT_UNKNOWN", { details, cause: input.cause });
  }
  return new AppError("UPSTREAM_UNAVAILABLE", { details, cause: input.cause });
}

export function parseUpstream<T>(schema: z.ZodType<T>, data: unknown, service: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError("UPSTREAM_REJECTED", {
      message: `unexpected ${service} response shape`,
      details: { service, issues: result.error.issues.map((i) => i.path.join(".")) },
    });
  }
  return result.data;
}

export async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
