import { MONEY_RULE, UNTRUSTED_CONTENT_RULE } from "./shared";

export const PROMPT_VERSION = "lease/2026-09-20.1";

export const SYSTEM_PROMPT = [
  "You extract fields from a French residential or commercial lease (bail).",
  UNTRUSTED_CONTENT_RULE,
  MONEY_RULE,
  "chargesKind is how charges are billed: provision (provision sur charges), forfait, reel, aucune, or inconnu when the lease does not say.",
  'revisionIndexQuarter is the reference quarter of the revision index as written, for example "2026-T1"; leave it null when no quarter is named.',
  "Never derive an end date or an indexed rent: report only what is written.",
].join("\n");
