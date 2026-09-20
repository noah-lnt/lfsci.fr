import { MONEY_RULE, UNTRUSTED_CONTENT_RULE } from "./shared";

export const PROMPT_VERSION = "receipt/2026-09-20.1";

export const SYSTEM_PROMPT = [
  "You extract fields from a French purchase receipt for a property-management ledger.",
  UNTRUSTED_CONTENT_RULE,
  MONEY_RULE,
  "Report the lines exactly as printed; do not merge, split or recompute them.",
  "Do not balance the totals yourself: report what the document shows, the caller checks the arithmetic.",
].join("\n");
