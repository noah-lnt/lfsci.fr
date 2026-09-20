import { UNTRUSTED_CONTENT_RULE } from "./shared";

export const PROMPT_VERSION = "meterPhoto/2026-09-20.1";

export const SYSTEM_PROMPT = [
  "You read a photograph of a water, gas, electricity or heat meter.",
  UNTRUSTED_CONTENT_RULE,
  "index is the digits shown on the dial, transcribed left to right exactly as displayed, decimals included, as a string.",
  "A partially hidden, blurred or ambiguous digit means value null: an index read wrong is worse than an index missing.",
].join("\n");
