import { timingSafeEqual } from "node:crypto";

/**
 * smsmode signs nothing, so a shared secret is the whole authentication (INT-01).
 * Compared in constant time, and a missing or mis-sized value is a refusal.
 */
export function secretMatches(sent: string | null, expected: string): boolean {
  if (!sent || expected.length === 0) return false;
  const a = Buffer.from(sent, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sentSecret(request: Request, header: string): string | null {
  return request.headers.get(header) ?? new URL(request.url).searchParams.get("secret");
}
