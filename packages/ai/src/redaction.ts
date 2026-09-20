import { redactValue } from "@lfsci/kernel";

/**
 * A run this long is a card, RIB or account number; no extraction field needs one.
 * Policy numbers, meter serials and invoice references observed so far stay below it.
 */
export const DEFAULT_MIN_DIGIT_RUN = 14;

export const IBAN_PLACEHOLDER = "[iban]";
export const DIGITS_PLACEHOLDER = "[digits]";

export type RedactionOptions = {
  minDigitRun?: number;
};

function digitRunPattern(minDigits: number): RegExp {
  return new RegExp(String.raw`\d(?:[ .\-]?\d){${Math.max(minDigits - 1, 0)},}`, "g");
}

export function redactForModel(text: string, options: RedactionOptions = {}): string {
  const minDigitRun = options.minDigitRun ?? DEFAULT_MIN_DIGIT_RUN;
  const withoutIban = String(redactValue(text));
  return withoutIban.replace(digitRunPattern(minDigitRun), DIGITS_PLACEHOLDER);
}

export function containsRedactedIban(text: string): boolean {
  return text.includes(IBAN_PLACEHOLDER);
}
