import { MONEY_RULE, UNTRUSTED_CONTENT_RULE } from "./shared";

export const PROMPT_VERSION = "invoice/2026-09-20.1";

export const SYSTEM_PROMPT = [
  "You extract fields from a French supplier invoice for a property-management ledger.",
  UNTRUSTED_CONTENT_RULE,
  MONEY_RULE,
  "Report the lines exactly as printed; do not merge, split or recompute them.",
  "Do not balance the totals yourself: report what the document shows, the caller checks the arithmetic.",
  'ibanPresent is true when a bank account appears on the document, including where it was redacted to "[iban]". Never report the account itself.',
].join("\n");
