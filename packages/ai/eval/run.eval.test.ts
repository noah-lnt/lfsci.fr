import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aiConfigFromEnv, createAiClient } from "../src/client";
import {
  aggregate,
  type DocumentScore,
  type ExtractedField,
  markdownTable,
  scoreDocument,
} from "../src/eval/score";
import { type DocumentKind, extractDocument } from "../src/extract";

/**
 * Opt-in: it calls the configured provider for real. Both gates must be open,
 * so a corpus dropped into the repository never makes `npm run check` reach the
 * GPU box. See `docs/ai-eval.md`.
 */
export const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "corpus");
const enabled = process.env.AI_EVAL === "1" && existsSync(CORPUS_DIR);

const MIN_VALUE_ACCURACY = Number(process.env.AI_EVAL_MIN_VALUE_ACCURACY ?? "0.8");
const MAX_INVENTED_EVIDENCE = Number(process.env.AI_EVAL_MAX_INVENTED_EVIDENCE ?? "0");

type CaseFile = {
  kind: DocumentKind;
  /** Expected value per field path, e.g. `"totalInclTax": "2.40"`. */
  fields: Record<string, string | null>;
};

type EvalCase = { id: string; kind: DocumentKind; fields: CaseFile["fields"]; text: string };

function loadCases(): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const file of readdirSync(CORPUS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    const textFile = join(CORPUS_DIR, `${id}.txt`);
    if (!existsSync(textFile)) continue;
    const reference = JSON.parse(readFileSync(join(CORPUS_DIR, file), "utf8")) as CaseFile;
    cases.push({
      id,
      kind: reference.kind,
      fields: reference.fields,
      text: readFileSync(textFile, "utf8"),
    });
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

/** The extraction schemas nest fields; the reference addresses them by dotted path. */
function flatten(output: unknown, prefix = ""): Record<string, ExtractedField> {
  const flat: Record<string, ExtractedField> = {};
  if (!output || typeof output !== "object") return flat;
  for (const [key, raw] of Object.entries(output as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (raw && typeof raw === "object" && "value" in raw && "evidence" in raw) {
      const entry = raw as { value: unknown; evidence: ExtractedField["evidence"] };
      flat[path] = { value: entry.value, evidence: entry.evidence };
      continue;
    }
    if (Array.isArray(raw)) {
      for (const [index, item] of raw.entries())
        Object.assign(flat, flatten(item, `${path}.${index}`));
      continue;
    }
    if (raw && typeof raw === "object") Object.assign(flat, flatten(raw, path));
  }
  return flat;
}

describe.skipIf(!enabled)("ai extraction evaluation (IA-04)", () => {
  it("extracts the reference fields and grounds every piece of evidence it offers", async () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThan(0);

    const config = aiConfigFromEnv();
    const ai = createAiClient(config);
    const scores: DocumentScore[] = [];

    for (const one of cases) {
      const result = await extractDocument(ai, { kind: one.kind, ocrText: one.text });
      expect(result.ok, `${one.id}: ${result.ok ? "" : result.detail}`).toBe(true);
      if (!result.ok) continue;
      scores.push(
        scoreDocument(
          { id: one.id, fields: one.fields, sourceText: one.text, hasPageImages: false },
          flatten(result.output),
        ),
      );
    }

    const total = aggregate(scores);
    process.stdout.write(
      `\n${markdownTable(scores)}\n\nmodèle: ${ai.modelId} · justesse: ${(total.valueAccuracy * 100).toFixed(1)} % · preuves inventées: ${total.inventedEvidence}\n`,
    );

    expect(total.valueAccuracy).toBeGreaterThanOrEqual(MIN_VALUE_ACCURACY);
    expect(total.inventedEvidence).toBeLessThanOrEqual(MAX_INVENTED_EVIDENCE);
  });
});
