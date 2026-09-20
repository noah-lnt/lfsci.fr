# Evaluating the extraction quality (IA-04)

The harness exists; the corpus is empty. Nothing here runs until real documents are dropped in, and nothing here runs during `npm run check`.

Why it matters: spec IA-04 forbids automating a document class before its quality is measured on real documents. A first pass on a small model returned the right supplier, date and totals **and invented the `evidence.bbox` coordinates** on text-only input. A score that only compared values would have called that run a success, so the evidence block is scored too.

## What you drop in

One pair of files per document, in `packages/ai/eval/corpus/` (the directory does not exist yet — create it):

```
packages/ai/eval/corpus/
  recu-001.txt      the document's text, as the OCR returns it
  recu-001.json     what the document actually says
```

`recu-001.json`:

```json
{
  "kind": "receipt",
  "fields": {
    "supplier": "Boulangerie de la Place",
    "date": "2026-09-12",
    "totalInclTax": "2.40",
    "totalExclTax": "2.27",
    "tax": "0.13",
    "paymentMethodHint": "CB",
    "lines.0.description": "2 baguettes",
    "lines.0.amount": "2.40"
  }
}
```

- `kind` is one of `receipt`, `invoice`, `attestation`, `lease`, `meterPhoto`.
- `fields` addresses the extraction schema by dotted path; an array element is `lines.0.amount`.
- A field that **must** come back empty is written `null`. That is not a formality: it is how the harness catches a model that fills a blank line.
- Only list the fields that matter for the decision the field drives. A field you leave out is not scored.

**Redact before you commit anything.** Names of real tenants, suppliers or partners do not belong in the repository (global rule §4): replace them, keeping the shape of the document. The plan targets 30 receipts, 20 invoices, 10 attestations and 10 leases.

## Running it

```bash
eval "$(fnm env)" && fnm use 24
AI_EVAL=1 npx vitest run --project ai-eval
```

Both gates must be open — `AI_EVAL=1` **and** the corpus directory — so a corpus sitting in the repository never makes `npm run check` call the GPU box. The run uses whatever `AI_PROVIDER`, `OLLAMA_BASE_URL` and `OLLAMA_MODEL_TEXT` point at, so it measures the model you are actually about to run in production.

Thresholds, overridable per run:

| Variable | Default | Meaning |
|---|---|---|
| `AI_EVAL_MIN_VALUE_ACCURACY` | `0.8` | Minimum share of scored fields whose value is right |
| `AI_EVAL_MAX_INVENTED_EVIDENCE` | `0` | Maximum number of invented evidence blocks tolerated |

## What the score means

The run prints one row per document plus a summary line.

**Champs justes** — the field value matched the reference. Amounts compare as numbers (`2.40` and `2,4` are equal to the cent); text compares without accents or case. A field expected `null` counts as right only if the model left it empty.

**Preuves fondées** — the model offered a quote and that quote is in the source text. This is the only evidence a text-only run can prove.

**Preuves inventées** — one of:

- a quote that is nowhere in the source text;
- a bounding box on a run that sent no page image, which no model can observe;
- any evidence attached to a field whose value came back empty.

A field with no evidence at all is `absent`, not invented: silence is honest, a fabricated citation is not.

**Justesse** is matched fields over scored fields. **Preuves inventées** is a count, and its default budget is zero, because MEM-02 requires every factual claim to carry a source that holds up. A model that scores 95 % on values with a handful of invented citations is **not** ready to automate: the owner would be approving proposals whose justification points at nothing.

## What to do with a result

- Accuracy below the floor, or any invented evidence → the class stays manual. Record the figures below and try another model or another prompt; a prompt change bumps `PROMPT_VERSION` in `packages/ai/src/prompts/`.
- Green on a class → that class may move up an autonomy level, one level at a time, and the run is repeated after any model, prompt or schema change (a regression disables the class again).

## Results

| Date | Model | Class | Documents | Justesse | Preuves inventées | Verdict |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | Corpus not supplied yet |
