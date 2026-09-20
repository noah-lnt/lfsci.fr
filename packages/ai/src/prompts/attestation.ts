import { UNTRUSTED_CONTENT_RULE } from "./shared";

export const PROMPT_VERSION = "attestation/2026-09-20.1";

export const SYSTEM_PROMPT = [
  "You extract fields from a French insurance certificate (attestation d'assurance) covering a dwelling or a building.",
  UNTRUSTED_CONTENT_RULE,
  'Dates are ISO "YYYY-MM-DD". coverage lists the guarantees as printed, one string per guarantee.',
  "The insured name is the person or company named on the certificate, not the agency issuing it.",
].join("\n");
