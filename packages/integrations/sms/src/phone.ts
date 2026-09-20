import type { CountryCode, NumberType } from "libphonenumber-js/max";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

// A paid send is billed whatever the line type, so only these two may be dialled (house rule).
export const SENDABLE_TYPES = new Set<NumberType>(["MOBILE", "FIXED_LINE_OR_MOBILE"]);

export type NormalizedMobile =
  | { ok: true; e164: string; country: CountryCode | undefined; type: NumberType }
  | { ok: false; reason: "empty" | "unparseable" | "invalid" | "unknown_type" | "not_mobile" };

export function normalizeFrenchMobile(
  input: string,
  defaultCountry: CountryCode = "FR",
): NormalizedMobile {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed) return { ok: false, reason: "unparseable" };
  if (!parsed.isValid()) return { ok: false, reason: "invalid" };

  const type = parsed.getType();
  if (!type) return { ok: false, reason: "unknown_type" };
  if (!SENDABLE_TYPES.has(type)) return { ok: false, reason: "not_mobile" };

  return { ok: true, e164: parsed.number, country: parsed.country, type };
}
