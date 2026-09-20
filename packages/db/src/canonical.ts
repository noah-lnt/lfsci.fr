import { createHash } from "node:crypto";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Deterministic JSON: object keys sorted, undefined dropped, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

function normalize(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = normalize(source[key]);
    }
    return out;
  }
  return null;
}
