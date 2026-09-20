# lfsci.fr — Tech pack v1

Companion to the functional spec `cahier-des-charges-gestion-patrimoniale.md` (v1.2). The spec says what the product must do; this document fixes how it is built: stack, architecture, data, integrations, AI, UI and operations. Every pick carries the version and date verified on **2026-09-19** against the npm registry or the vendor's own documentation, the runner-up, and the risk. What nobody could verify is listed in §14 and must be checked before the corresponding code is written. Decisions that belong to the owner are numbered `D-nn` and collected in §14.2.

## 0. Constraints that shape every choice

- **Odoo Online is the ledger.** Its external API is JSON-2 (`POST /json/2/<model>/<method>`, bearer API key, `/doc` for per-database discovery). One HTTP call is one SQL transaction; nothing spans two calls. The API needs the **Custom** plan. Odoo's acceptable-use policy implies roughly one call per second and no parallel calls.
- **One Linux VPS, `local-nolan-sarl`.** Docker Compose behind the shared Traefik (network `web`, entrypoint `websecure`, certresolver `letsencrypt`, middleware `internal-allowlist@file` available), images built on the server, no registry. The CPU has **no AVX**. Its RAM is undocumented (org rule, 2026-09-19): measure before sizing, and every service declares `deploy.resources.limits.memory`.
- **npm workspaces**, TypeScript everywhere, French-first UI, English code and docs.
- **RGPD.** Tenant documents contain personal data. EU processing is the default wherever a provider offers it; per-tenant deletion must reach OCR text, embeddings and thumbnails (spec RGPD-03).
- **The owner is user zero**, solo, often on a phone with one free hand.
- **Spec NFRs:** p95 < 2 s on pages and timelines, 1 000 lots / 1 M timeline events / 100 k documents, WCAG 2.2 AA, RPO 1 h and RTO 8 h.

## 1. Architecture

```
  browser / PWA (owner)                      accountant / associate (browser)
          │                                            │
          └──────────────── Traefik (websecure) ───────┘
                                   │
                 ┌─────────────────┴──────────────────┐
                 │  lfsci-web  (Next.js 16, standalone) │
                 │  RSC pages · oRPC handlers · SSE     │
                 └─────────────────┬──────────────────┘
                                   │ same Postgres
        ┌──────────────────────────┼──────────────────────────┐
        │  lfsci-worker (Node 24 + pg-boss)                   │
        │  OCR · extraction · Odoo sync · nightly controls    │
        │  PDF (Typst) · messaging · imports · embeddings     │
        └──────────────────────────┬──────────────────────────┘
                                   │
                 ┌─────────────────┴──────────────────┐
                 │  lfsci-db (PostgreSQL 18 + pgvector) │
                 │  data · jobs · outbox · FTS · vectors│
                 └────────────────────────────────────┘
                                   │
   S3 (Scaleway fr-par) ◄──────────┴──────────► Odoo Online (JSON-2)
   Claude via Bedrock eu-west-3 · Mistral OCR EU · Gladia · Resend · smsmode
   INSEE (IRL) · ADEME (DPE) · IGN Géoplateforme (addresses, cadastre)
```

A **modular monolith** (spec ARC-01): one deployable web app, one worker process, one database. Two containers because Next.js has no long-running worker runtime; both are built from the same repository and share the same packages.

### 1.1 Repository layout

```
apps/web/            Next.js 16 app: UI, oRPC route handlers, SSE routes, auth
apps/worker/         pg-boss workers, cron schedules, Typst CLI, no HTTP surface
packages/db/         Drizzle schema, SQL migrations, RLS policies, seed
packages/domain/     pure functions over plain data: rent terms, IRL, prorata,
                     charge keys, allocations, loan schedules, deposits (decimal.js)
packages/contracts/  Zod schemas shared by web, worker and tests: commands,
                     approvals, extraction outputs, oRPC procedure types
packages/integrations/
  odoo/              the ONLY package that sees Odoo credentials
  storage/           S3 client, presigned URLs, content sniffing
  ocr/               Mistral OCR client
  speech/            Gladia client
  mail/  sms/        Resend, smsmode
  opendata/          INSEE IRL, ADEME DPE, IGN geocoding and cadastre
  pdf/               Typst templates and compile wrapper
packages/ai/         Claude client factory (Bedrock or first-party), extraction
                     prompts and schemas, assistant tools (propose-only)
docs/                spec, tech pack, schema, research
```

Module boundaries follow the spec's seven modules (patrimoine, location, finance, documents, temporalité, intégration, IA). In `apps/web` each feature module owns three files, `src/lib/contracts/<module>.ts` (oRPC contract), `src/server/rpc/modules/<module>.ts` (handlers) and `src/i18n/messages/<module>.json` (strings), plus its route folder under `src/app/(app)/`, its components under `src/components/<module>/` and its data access under `src/server/<module>/`; `lib/contract.ts`, `server/rpc/router.ts` and `i18n/messages/index.ts` only assemble them. In `apps/worker` each queue is one file under `src/jobs/`. The client/server and Odoo boundaries are lint-enforced (§10.1).

No `packages/ui`: the shadcn components live in `apps/web/src/components/ui`. A shared UI package only pays off with a second app, and the house has already deprecated one such package.

## 2. Platform decisions

| # | Item | Pick | Version · date | Why | Runner-up | Risk |
|---|---|---|---|---|---|---|
| P1 | Web framework | **Next.js 16**, App Router, `output: "standalone"` | 16.3.5 · 2026-09-11 | Turbopack default, Cache Components, Build Adapters API stable since 16.2 so self-hosting has parity with Vercel; RSC + route handlers give SSE and server-side auth in one codebase; five sibling Nolan products run it | TanStack Start (still RC, no 1.0 a year after the RC announcement) | Frequent security batches: pin exact, subscribe to advisories; `NEXT_PUBLIC_*` values are baked at image build |
| P2 | Typed API | **oRPC** for procedures, raw route handlers for SSE and uploads | `@orpc/server` 1.15.2 · 2026-09-19 | Same DX as tRPC, emits OpenAPI (spec ARC-02 asks for an OpenAPI contract), speaks Standard Schema so Zod 4 plugs in directly | tRPC 11.19 (no OpenAPI output) | Young 1.x; `@orpc/trpc` interop is the escape hatch |
| P3 | Database | **PostgreSQL 18** + **pgvector ≥ 0.8.2** | PG 18 GA 2025-09-25 · pgvector 0.8.2 | Async I/O, native `uuidv7()`, `NUMERIC` money, GIN and partial indexes, RLS; pure C, x86-64 baseline, no AVX question. One engine for data, jobs, full-text and vectors | PG 17 | pgvector < 0.8.2 has a buffer overflow in parallel HNSW builds: pin ≥ 0.8.2; build HNSW non-parallel with raised `maintenance_work_mem` |
| P4 | ORM and migrations | **Drizzle ORM**, SQL migrations reviewed in git | 0.45.2 · 2026-03-27 | Generates plain `.sql` you read before applying (the right posture next to a ledger); `numeric` comes back as a **string**, never a float; native `pgPolicy` for RLS; time-lap already runs it | Kysely 0.29.6 | The stable line is frozen while 1.0 is in beta: plan the 1.0 migration. Prisma was excluded because its npm `latest` tag currently points at an 8.0 release candidate and its migration review ergonomics are weaker |
| P5 | Jobs, cron, outbox | **pg-boss** | 12.33.2 · 2026-09-18 | Transactional workers since 12.32: the outbox row and the job completion commit in one transaction (spec SYN-01); cron and RRULE schedules; singleton keys; dead-letter queues; exponential backoff; `TestClock` for deterministic tests | Graphile Worker 0.18 | At-least-once, not exactly-once: every handler is idempotent on the outbox id. BullMQ excluded: it adds Redis, a second stateful service on a RAM-bound box, with no transactional enqueue |
| P6 | Auth | **better-auth** with organization, passkey and two-factor plugins | 1.7.5 · 2026-09-14 | Auth.js joined Better Auth on 2025-09-22 and is security-patch-only; organization plugin gives tenants, roles, invitations and dynamic access control; owns its Drizzle tables; httpOnly cookie sessions | Ory Kratos (separate identity service) | Fast-moving 1.x with a June 2026 security update: pin exact, subscribe to advisories. Lucia is deprecated |
| P7 | Object storage | **Scaleway Object Storage, region `fr-par`**, private buckets, presigned URLs | — | Removes a stateful service from the VPS; French jurisdiction; requests and ingress included, 75 GB/month egress free | Garage v2.3 on the box (`--single-node`) if data must never leave the VPS | **MinIO is out**: maintenance mode since December 2025, repository archived 2026-04-25 (the kycone stack still runs it). Garage is AGPL, fine as a sidecar |
| P8 | Search and memory | **Postgres full-text** (`french` config + `unaccent`, GIN) + **pgvector HNSW** | PG 18 | One `DELETE … WHERE organization_id = $1` provably removes embeddings (RGPD-03); RLS applies to vectors; no extra RAM; embeddings computed by API call, never by a local ONNX runtime (that is where AVX bites) | Meilisearch if BM25 relevance proves insufficient | HNSW build memory; `ef_search` tuning is ours |
| P9 | Monorepo | **npm workspaces + Turborepo** | turbo 2.11.2 · 2026-09-18 | Turbo's local cache makes on-server image builds bearable: unchanged packages do not rebuild | bare `npm run -ws` | Remote cache unused |
| P10 | TypeScript | **TypeScript 6.x now, 7.x at 7.1** | — | 7.0 (2026-07-08, Go-native `tsgo`) has no stable programmatic API until 7.1; type-aware lint and codegen may break. Use `tsgo --noEmit` opportunistically for speed once 7.1 ships | TS 7.0 today | Verify the lint chain before switching |
| P11 | Lint and format | **Biome 2** for everything, **ESLint 9** scoped to a11y and module-boundary rules only | Biome 2.5.14 · 2026-09-16; ESLint 9.39.5 (ESLint 10 is out, but `eslint-plugin-jsx-a11y` 6.10.2 declares a peer range ending at 9, measured at install on 2026-09-20) | One fast binary for format and lint; Biome's a11y and React rule coverage is still narrower than `eslint-plugin-jsx-a11y`, and WCAG 2.2 AA is a spec target | ESLint flat config alone | Two linters; keep ESLint's scope explicit; move to ESLint 10 when the a11y plugin allows it |
| P12 | Tests | **Vitest 5** unit and integration, **Playwright** e2e with **axe-core** | Vitest 5.0.1 · 2026-09-15; Playwright 1.63.0 · 2026-09-04; axe-core 4.13.0 | Vite-native, ESM-first; Playwright drives the PWA capture flow on real browsers, runs axe on every route, snapshots PDFs | Node test runner | Vitest 5 is days old: pin exact |
| P13 | Node | **Node 24 LTS** | 24.21.0 · 2026-09-07 | Node 22 is in maintenance; Node 26 becomes LTS on 2026-10-28 (revisit then) | Node 22 | none |
| P14 | Worker build | **tsdown** | 0.23.0 · 2026-09-03 | Rolldown-based successor path for tsup (dormant since 2025-11) | run workers with `tsx` | 0.x |
| P15 | Validation | **Zod 4** | 4.6.5 · 2026-09-13 | Standard Schema: plugs into oRPC, TanStack Form and Drizzle without adapters | Valibot 1.5 | Money is validated as a decimal **string**, never `z.number()` |
| P16 | Money | **`NUMERIC(14,2)` in Postgres, string on the wire, decimal.js for arithmetic** | decimal.js 10.6.0 | No float ever touches a rent amount (an Odoo reconciliation bug class); rounding rules (largest remainder, stable order) live in `packages/domain` with the fixtures from the spec §21.2 | Dinero.js v2 | none |
| P17 | Dates | **date-fns v4 + `@date-fns/tz`**, `fr` locale; period arithmetic on `date` columns in SQL | 4.4.0 · 2026-05-29 | Temporal is Stage 4 but Safari stable has not shipped it and the polyfill is stale (0.5.1, 2025-03); a mobile-first French app cannot depend on it | Temporal + polyfill | Contract dates are `date`, technical instants `timestamptz` (spec §14) |

## 3. Integration and AI decisions

| # | Item | Pick | Facts verified | Runner-up | Risk |
|---|---|---|---|---|---|
| I1 | Odoo access | **JSON-2 external API** (Odoo 19) with a **JSON-RPC transport** for Odoo 18 (`execute_kw`, positional `create`/`write` arguments, HTTP 200 error envelopes), one bot user with an API key per environment, `X-Odoo-Database` header when needed | Endpoint `POST /json/2/<model>/<method>`, `Authorization: bearer <key>`, per-database `/doc`, methods `search_read/create/write/unlink`, JSON error payload with `name`/`message`/`arguments`; neutralised test duplicates expire after 15 days, max 5 | XML-RPC (legacy) | **Custom plan required** (D-01). Attachment upload is undocumented in the JSON-2 reference: `ir.attachment` + base64 `datas` is an inference to confirm on `/doc` |
| I2 | Odoo events back to us | **Incremental `search_read` on `write_date`** with overlap window, plus periodic full audit; Studio "Send webhook notification" as an accelerator only | Studio webhooks exist and POST selected fields; no delivery guarantee documented | — | Never the sole mechanism (spec SYN-04) |
| I3 | Odoo MCP server | **Not used** for writes; at most read-only exploration by the owner | Odoo documents `/mcp` with an MCP-scoped API key | — | Would give an LLM direct write scope, contradicting IA-01 |
| I4 | Bank feed | **File import into Odoo first** (CAMT.053, then OFX, then CSV); live sync only after both institutions are confirmed in Odoo's provider list | Odoo France providers are Salt Edge and Ponto (Enable Banking is Scandinavia-only); Indy is not a bank and has no connector, so it is export-only | — | Banque Populaire coverage unverified (D-02) |
| I5 | LLM | **Claude Opus 5** (`claude-opus-5`) through the **Anthropic TypeScript SDK**; **Bedrock `eu-west-3` (Paris)** via `AnthropicBedrockMantle` from `@anthropic-ai/bedrock-sdk` for EU residency | Anthropic's first-party API offers only `us` and `global` inference geos; EU residency exists only through Bedrock or Vertex EU endpoints at a 10 % premium; Bedrock lacks Batches, Files API, server-side fallbacks and `inference_geo` | First-party API + DPA, cheaper and full-featured, if the owner accepts US processing (D-04) | Model choice is measured per route with evals before any cheaper model is introduced; `claude-sonnet-5` and `claude-haiku-4-5` are candidates for bulk extraction only after that measurement |
| I6 | LLM application layer | **Anthropic SDK directly**: `messages.parse` + `zodOutputFormat` for extraction, `betaZodTool` + `toolRunner({stream: true})` for the assistant | Structured outputs via `output_config.format`; prompt caching via `cache_control`; adaptive thinking is the default on Opus 5 | Vercel AI SDK 6 (its human-in-the-loop tool approval is attractive) | One fewer abstraction; approval happens outside the model loop anyway because tools only create proposals |
| I7 | OCR and layout | **Mistral OCR** on the **EU endpoint**; Claude sees OCR text and page images only when needed | `mistral-ocr-latest`, $4 per 1 000 pages, EU inference +10 %, tables and bounding boxes, batch available | Azure Document Intelligence France Central (prebuilt invoice and receipt, ~$10 per 1 000 pages, price unverified) | Pixel-level processing stays in the EU regardless of D-04 |
| I8 | E-invoices | **`@e-invoice-eu/core`** for Factur-X, UBL and CII parsing | TypeScript, EN 16931 | commercial InvoiceXML | Reception obligation started 2026-09-01: suppliers will send Factur-X even to a non-VAT SCI (spec DEP-04) |
| I9 | Voice notes | **Gladia** async transcription, French infrastructure, zero audio retention | French company, region selectable per call, from $0.61/h | Mistral Voxtral Mini Transcribe 2 ($0.003/min, EU endpoint +10 %) | Accuracy claims are vendor benchmarks: keep a 30-note French eval set. whisper.cpp self-hosting rejected: needs AVX2/FMA for its fast path |
| I10 | E-signature (V2) | **Youtrust API v3** (Yousign renamed), sandbox `api-sandbox.yousign.app/v3` | Free sandbox, webhooks, French QTSP | Universign pay-as-you-go (~€0.75 per signature, unverified) likely cheaper below 20 signatures a year | Quote both before V2 (D-06) |
| I11 | SMS | **None — owner decision 2026-09-20: email only.** Inbound SMS reach the inbox as pasted notes (CAP-02) | smsmode was evaluated (outbound from €0.0312 HT, SDA inbound number, French sender-ID rules since 2026-03-01) and dropped | Twilio French long code, if the channel is ever reopened | A reopened SMS channel must gate every send on `isValidNumber` and number type (Windtransfer lesson) |
| I12 | Email | **Resend** outbound (org rule) and **Resend Inbound** on our own domain (`inbound` MX) | GA since late 2025; `email.received` webhook carries metadata only, body and attachments are fetched through the Receiving API; Svix-signed | Cloudflare Email Routing + Worker (25 MiB cap) | Two-step ingestion: the fetch can fail independently, so it is a job |
| I13 | Open data | **INSEE BDM series `001515333`** (IRL, métropole) over SDMX REST; **ADEME DPE** dataset `dpe03existant` (no key); **IGN Géoplateforme geocoding** (50 req/s per IP, 429 with `retry-after`); **API Carto cadastre** (Parcellaire Express) | `api-adresse.data.gouv.fr` was decommissioned in January 2026 | — | INSEE portal auth scheme unverified |
| I14 | Airbnb and Booking | **File drop + iCal**, never API | No public Airbnb API, partner programme closed to unsolicited applicants; Booking Connectivity requires PCI/PII onboarding and 24/7 support | — | Map CSV by header name, fail loudly on unknown headers, sort newest-first files on ingest |
| I15 | PDF | **Typst** CLI in the worker image | Rust static binary, official Docker image, millisecond renders, no browser | `@react-pdf/renderer` (in-process JS) | Templates are Typst markup, not React; AVX not documented either way (verify on the VPS) |
| I16 | Errors and logs | **pino** JSON to stdout, **Sentry SDK → GlitchTip** on the observability box (org rule), **OpenTelemetry traces and metrics** later | OTel JS logs are still experimental | Sentry SaaS EU | Audit trail lives in `audit_log`, never in logs |

## 4. Data layer

- **Schema source of truth:** `docs/schema/lfsci.sql` (annex, PostgreSQL 17-compatible DDL, drafted from spec §14). Drizzle's schema is generated to match it, and every migration is a reviewed `.sql` file under `packages/db/migrations`.
- **Tenancy:** every tenant table carries `organization_id`; RLS is enabled with a policy on `current_setting('app.organization_id', true)`; the application sets it with `SET LOCAL` at the start of every transaction, and the application layer still filters by organization (defence in depth, as kycone does). A tenant boundary test (spec QA-03) proves that a guessed id, a search and a download link all return 404.
- **Identifiers:** `uuid` primary keys, UUIDv7 generated by the app (time-ordered inserts), `gen_random_uuid()` as the column default.
- **Money and dates:** §2 P16 and P17. Percentages and keys as `numeric(9,6)`; the rounding is done once in `packages/domain` with the largest-remainder method and a stable order (spec T-F06).
- **Timeline links** use an `object_ref` registry (one row per linkable object, exactly one FK set) so `activity`, `event` and `deadline` link with referential integrity and never across organizations (spec MOD-01).
- **External references:** `external_ref (organization_id, odoo_database, model, external_id)` unique, and `(organization_id, model, internal_id)` unique.
- **Commands and approvals:** `command` unique on `(organization_id, operation_key)` with `payload_hash`; `approval` stores the approved hash, scope and expiry (IA-03).
- **Derived data** (search documents, embeddings, thumbnails, OCR text) lives in its own tables so a tenant purge is a set of `DELETE` statements and a rebuild is a job.
- **Verified on 2026-09-19** against PostgreSQL 18.6 with pgvector 0.8.6, btree_gist and unaccent: the file loads clean under `ON_ERROR_STOP`, giving 91 tables, 90 RLS policies with RLS enabled and forced on every tenant table, and one HNSW index. `docs/schema/verify.sql` proves that a cross-tenant `object_ref` is refused by the composite foreign key, that an unbalanced expense allocation fails at commit while a balanced one commits, and that RLS returns no rows without the tenant setting and only the right organization's rows with it.
- **Settled points from the schema review:** one organization may hold several legal entities (spec §2), consolidation stays V2; `person` holds tenants, partners, guarantors and supplier contacts with dated roles, and the retention matrix keys on the role, not the table; `char(3)` currency with no multi-currency lease; the SCI's own IBANs live encrypted in `bank_account`, counterpart accounts keep only a fingerprint and the last four digits; the `object_ref` composite-key design costs 24 nullable columns and a migration per new linkable type, accepted for database-enforced tenant isolation; exclusion constraints forbid overlapping unit usage periods, main lease units and equipment assignments, stricter than the spec's "controlled overlap" (D-12).
- **Audit log:** append-only, hash-chained, frozen column set (kycone lesson: never add a column, since `hash` covers a fixed field set); enforced by a DB role without `UPDATE`/`DELETE` plus triggers raising SQLSTATE 45000 (pneuscope lesson).
- **Migrations in production:** a one-shot `lfsci-migrate` compose service behind a profile, run before `up -d --wait`; never from the app entrypoint.
- **Backups (RPO 1 h):** hourly `pg_dump` to a separate S3 bucket while the database stays under ~2 GB, nightly full retained 35 days, quarterly restore drill with hash checks (spec BCP-01). Upgrade path when the database grows: WAL archiving with wal-g or pgBackRest (versions to verify, §14).

## 5. Commands, outbox and jobs

The spec's execution model (SYN-01 to SYN-06, ARC-02) maps onto pg-boss like this:

1. A mutation writes, in **one transaction**: the domain change, the `command` row (`prepared`), the `approval` if the decision level demands one, the `audit_log` entry, and the `outbox_entry`.
2. When the command is `authorized`, the same transaction enqueues a pg-boss job keyed on the outbox id (singleton key = operation key, so a duplicate enqueue is a no-op).
3. The worker handler runs inside pg-boss's transactional worker: it re-checks rights, expected version, closed period, amounts and approval validity (SYN-01), performs the external call, records a `command_attempt`, and commits `sent → confirmed` with the job completion.
4. **Unknown result** (timeout, lost response): the attempt is marked `unknown`, the job is **not** retried blindly; a separate reconciliation job searches Odoo for the stable operation reference and either confirms, opens an exception (several matches or a different payload) or, only when the search proves absence after the call could no longer be executing, allows a controlled retry (SYN-03).
5. Retries with exponential backoff and jitter only on **transport** failures; a business rejection (closed period, validation error) is terminal and visible (GLA breaker lesson: only transport failures feed the circuit breaker).
6. Cron via pg-boss schedules: nightly controls (OPS-02), rent term preparation (WF-02), deadline generation, Odoo back-sync, backups. Each run writes a report row: controls expected, executed, failed; an all-calls-failed run returns failure and advances no cursor (global rule).
7. Rate limiting toward Odoo: a token bucket in the connector, default 1 request/s, no parallelism (D-01 may raise it once the owner has the plan's real quota in writing).

## 6. Odoo connector contract

Package `packages/integrations/odoo` is the only code holding the Odoo base URL, database and API key (encrypted at rest with AES-256-GCM, key from the environment). It exposes typed functions, not a generic RPC proxy (spec ARC-02).

| Concern | Design |
|---|---|
| Discovery | Phase 0 snapshots `/doc` for the target database into `integration_capability` (models, fields, methods, rights of the bot user). Code targets that snapshot, never a remembered method name |
| Reads | `search_read` with explicit `fields`, pagination by `(write_date, id)`, overlap window of 10 minutes, cursor stored in `integration_cursor` and advanced only after the page is persisted |
| Writes | One typed function per business operation (`postSupplierBill`, `postRentTerm`, `attachDocument`, `proposeReconciliation`…). Each writes a stable operation reference into a dedicated field agreed in Phase 0 (a Studio text field, indexed, **not** unique: the SaaS keeps the uniqueness guarantee) |
| Multi-step operations | Draft, attachment, validation are separate transactions on Odoo's side; the connector is a state machine that re-reads Odoo state between steps and resumes from what exists (SYN-02) |
| Conflicts | Field authority per spec §4; a value that differs from the contract opens an exception with expected value, ledger value, author when available, and possible actions (SYN-05); never "last write wins" on accounts or amounts |
| Closed periods | Measured on Odoo 18 (Phase 0, 2026-09-20): Odoo does **not** refuse, it moves the accounting date past the lock. The connector therefore reads `res.company` lock dates before any posting and refuses locally with `PERIOD_LOCKED`; the SaaS never lets a date shift (WF-12) |
| Health | Last success, lag, pending commands, quota consumption, exposed on `GET /v1/integrations/{id}/health` and on the dashboard banner (SYN-06) |
| Test base | Every Phase 0 and CI integration run targets a neutralised duplicate (external actions disabled), never the live base; the duplicate expires after 15 days, so its creation is part of the test procedure |

## 7. AI layer

**Principle (IA-01):** the model extracts, classifies, proposes and explains. Amounts, dates, eligibility, rights and every external effect come from `packages/domain` and the command pipeline. The model never receives Odoo credentials, SQL, or a tool that executes anything.

| Route | Mechanism | Notes |
|---|---|---|
| Document extraction (receipt, invoice, attestation, lease) | Worker job: Mistral OCR → `client.messages.parse` with `zodOutputFormat(schema)` per document class; the schema carries per-field evidence (page, bbox or quoted text) and a confidence the engine uses, never the model's self-reported certainty alone | `ai_extraction` rows keep field, evidence, model id, prompt version, decision (MOD-02). Totals are cross-checked arithmetically (DEP-01). PDF input goes through the `document` content block when a page image is needed (≤ 32 MB, ≤ 600 pages) |
| Inbox triage (email, SMS, note, voice) | Same parse call with an intent schema: person, unit, lease, dates, document kind, proposed links, and an explicit "why uncertain" | Instructions found inside content are data (IA-02): the schema has no field a document could use to change permissions or recipients |
| Voice note | Gladia transcript → parse into a structured intervention or note; audio deleted after validation plus a short configurable delay (spec retention table) | |
| Assistant (UX-06) | SSE route in `apps/web`; `client.beta.messages.toolRunner({ stream: true })` with `betaZodTool` tools and `eager_input_streaming: true`; text deltas streamed to the client; `stop_reason` checked every turn (`max_tokens` with a tool call aborts, `refusal` aborts) | Tools: `get_action_required`, `summarize_object`, `search_memory` (rights applied before retrieval and re-checked on results, MEM-01), `explain_amount` (deterministic query with sources), `propose_command` (creates a `command` in `prepared` state and returns its id; the UI renders the approval card). Nothing executes inside the loop |
| Rule proposals (IA-06) | A deterministic job detects repeated confirmations; the model only drafts the human-readable rule description | Activation stays a validated command |
| Nightly summaries and object summaries (MEM-03, V2) | Batch-friendly; each factual sentence cites an event or document id, and the totals come from SQL, not from the model | |

**Model settings.** `claude-opus-5` everywhere at launch; adaptive thinking on by default; `output_config.effort` `medium` for the assistant, `high` for extraction; `thinking.display: "summarized"` only where reasoning is shown to the owner. System prompt frozen and cached with `cache_control` (stable prefix: tools, then system, then messages); operator instructions appended as mid-conversation `system` messages rather than edits to the cached prefix. When the first-party API is used (D-04), `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta is set by default; on Bedrock the SDK's client-side refusal-fallback middleware replaces it. `max_tokens` 16 000 non-streaming, 64 000 streaming.

**Local route (default, decided 2026-09-20).** `AI_PROVIDER=ollama` points `packages/ai` at an Ollama instance on the owner's GPU box (`OLLAMA_BASE_URL`, default `http://127.0.0.1:11434`), which solves residency by keeping every document on the owner's hardware. A provider interface (`src/provider.ts`) carries the two operations the app needs — `extractStructured` and `runToolLoop` — and the Anthropic/Bedrock code moves behind it unchanged; switching provider changes one variable. Extraction posts `/api/chat` with `format` set to the Zod schema converted by `z.toJSONSchema` (inlined, no `$ref`), `stream: false`, `think: false` and `options.temperature: 0`, then parses the answer and validates it with the same Zod schema: a parse or validation failure is `parse_failed`, never a filled-in field. Page images ride the message's `images` array and switch the call to `OLLAMA_MODEL_VISION`; PDF bytes are `unsupported_input` on this route, so `document.analyze` must rasterise before it can send one. The assistant loops `/api/chat` with `tools`, streams NDJSON text deltas, answers each call as a `role: "tool"` message and caps the turns; the tools are the same propose-only ports, nothing executes. A refused connection, timeout or HTTP error is `UPSTREAM_UNAVAILABLE`, an uninstalled model `UPSTREAM_REJECTED` with the model name. Defaults: `qwen3:32b` for text, `qwen3.5:27b` for vision, both Q4 inside the 32 GB card. Boot never probes the instance; `checkOllama()` (`GET /api/tags`) reports reachability and which configured models are missing, for the worker health endpoint and the web readiness probe. `embed` posts `/api/embed` with the whole batch as `input` and returns one vector per text in order; a row whose width is not `AI_EMBED_DIMENSIONS` is refused as `dimension_mismatch` rather than padded or truncated, and the Anthropic route answers a typed `unsupported` because it ships no embeddings endpoint. `checkOllama()` counts the embedding model among the ones it expects installed, so a missing `bge-m3` reads as `down` on both probes; `down` degrades the AI screens and the Accueil banner (« Modèle indisponible »), it never makes the application unready.

**Rasterising PDF pages (measured 2026-09-20).** `document.analyze` sits behind a `PageRenderer` port so the renderer is injectable, and ships with **poppler's `pdftoppm`**, added to the worker image as `poppler-utils`. Both candidates were timed on the same eight-page text PDF, each followed by whatever it takes to obtain capped JPEG pages: `pdftoppm -jpeg -jpegopt quality=82 -scale-to 1600`, one spawn per page plus a temporary file, **128–138 ms** for eight pages; `pdfjs-dist` 6.3 + `@napi-rs/canvas` rendering to a canvas and re-encoding with sharp, **563–730 ms**. Rendered output is equivalent (identical mean pixel value at 150 dpi, 3.5 MiB against 3.3 MiB of JPEG). Poppler wins on three counts: four times faster; no new node dependency (the JS path measured 62 MiB of `node_modules`, of which 27 MiB is a native canvas binary, so it is not a pure-JS path either); and it runs out of process, so a malformed or adversarial PDF is bounded by `timeout` + `SIGKILL` instead of stalling the worker. Note `pdftoppm` reads a file rather than stdin and exits non-zero once the page number passes the last page. Caps: `MAX_PDF_PAGES` 8 and `MAX_PAGE_EDGE` 1600 px, because the model payload and the VRAM, not the disk, are the constraint. A rasterisation failure is not a job failure: the job logs it and extracts from the OCR text alone, and the outcome carries `rasterisedPages` and `rasterisationDegraded`. Only the local route rasterises — the Anthropic providers still receive the PDF natively.

**Search indexing (MEM-01/MEM-02).** `search.index` runs every ten minutes across every organization and fills `search_document` then `embedding` for documents, activities, events and interventions. The text half is cursor-driven, one `integration_cursor` row per source table (`connector = 'search'`, `cursor_kind = 'timestamp'`) re-read with a 300-second overlap; every write is an upsert on the table's natural key, so a replay costs nothing. `tsv` is written by the job, not by a generated column, because `to_tsvector('french', unaccent(...))` is not IMMUTABLE. The vector half runs only after the text half and only picks rows that have no current embedding for the configured model, so an unreachable Ollama leaves the text index complete and the vectors to a later pass — a row is never half-written with a fabricated vector. An activity with no `activity_link` has no object to point at and is counted as `unlinked` rather than indexed under a wrong object. A pass whose every source failed on every organization throws and leaves every cursor where it was.

**Evaluation (IA-04).** A stratified sample of real documents per class (target 100 per class before automation), scored on critical fields; a per-route dashboard of precision, correction rate, cost per document and exception rate; any model, prompt or schema change re-runs the set; a regression disables the affected class of automation. The harness is in place and the corpus is empty until the owner supplies documents: an opt-in vitest project `ai-eval` (`AI_EVAL=1` plus a `packages/ai/eval/corpus` directory, both required, so a corpus in the repository never makes `npm run check` call a model) and a scoring module that compares values **and** the `evidence` block — a quote must be found in the source text and a bounding box cannot come from text-only input, because a first pass on a small model invented them. Procedure and score meaning: `docs/ai-eval.md`.

**Residency (D-04).** Default: Bedrock `eu-west-3`. Consequence: no Message Batches, no Files API, no server-side fallbacks; extraction volume at this scale does not need Batches. Alternative: first-party API with Anthropic's DPA, 30-day retention, US processing; cheaper and full-featured. The owner chooses; the client factory in `packages/ai` hides the difference.

## 8. Capture, inbox and timeline mechanics

- **PWA, not a store app, at MVP** (P-mobile). Camera via `<input type="file" accept="image/*" capture="environment">`, voice via `MediaRecorder`, queue in IndexedDB with the blob, a local status (`recorded on this device` → `synchronised`, UX-03) and a foreground flush on app focus and on `online`. **Background Sync is unsupported on iOS with no sign of change**, so the queue never depends on it; on Android it is progressive enhancement only. Photos are downscaled and re-encoded before enqueue to respect iOS storage quotas. iOS has no install prompt: the app teaches "Partager → Sur l'écran d'accueil" once.
- **V2 escape hatch:** Capacitor 8 wrapping the same app for background upload, native camera and store presence; Expo only if the mobile app becomes the product.
- **Uploads:** two-step (`POST /v1/documents/uploads` returns a presigned PUT, `finalize` verifies size and hash and enqueues analysis, spec §16.1). The browser never holds S3 credentials. Content type is sniffed server-side; images are re-encoded with `sharp`, PDFs normalised, previews rendered by the worker; documents open in a sandboxed viewer. A malware scanner (ClamAV) is **not** in the MVP stack because of its RAM footprint on this VPS (D-07).
- **Inbox:** one canonical row per source item, deduplicated on provider id (Resend `email_id`, smsmode message id, file hash), with source, original, extracted fields, proposed links, action and reason for uncertainty (INB-01).
- **Timeline:** cursor pagination on `(occurred_at, id)` through `object_ref` links; TanStack Virtual on the client; server-side aggregation of identical alerts (UX-01).

## 9. UI system

Baseline: the house `ui-kit.md` and `layout.md` conventions (shadcn components, Tailwind v4 tokens in `@theme`, `cn()`, lucide icons, dark mode with `@custom-variant dark`, the AppShell with sidebar and header, `PageNav`). Deviations are listed in §15.

| Layer | Pick | Version · date | Why |
|---|---|---|---|
| Components | **shadcn/ui on Base UI** | Base UI is shadcn's default since July 2026 | New project, so start on the default rather than migrate later; Radix remains supported if a component is missing |
| Styling | **Tailwind CSS v4** | 4.3.3 · 2026-07-16 | House rule; tokens in `@theme`, no config file |
| Data | **TanStack Query 5, Table 9, Virtual, Form** | react-query 5.103.1 · 2026-09-16; react-table 9.2.4 · 2026-08-28 | Headless: we own the markup, which is how a dense table meets WCAG 2.2 AA; Virtual keeps million-row timelines under the p95 target |
| Charts | **Recharts 3** with the house `recharts.md` wrappers ported to the v3 API | 3.10.1 · 2026-07-25 | Occupancy, cash-flow, arrears and forecast charts; downsample server-side beyond a few thousand points; ECharts if heavy time-series ever appear |
| Dates | date-fns v4 `fr` locale | | Display only; period math is server-side |
| Icons | lucide-react | 1.47.0 · 2026-09-17 | House rule |
| i18n | **next-intl**, French only, plumbing in place | | A second locale costs nothing later |
| Fonts | **Inter** (UI) with `font-variant-numeric: tabular-nums` on every amount and date column; **JetBrains Mono** for references and codes | | Tabular figures prevent layout shift in money columns; Inter's French diacritics and hinting are excellent |
| Accessibility | axe-core in Playwright on every route in CI; manual checks for WCAG 2.2 target size, focus not obscured and drag alternatives on the capture flow | axe-core 4.13.0 | axe finds about a third of WCAG issues; the rest is review |
| PDF documents | Typst templates for quittance, reçu, décompte de charges, état des lieux, inventaire, courrier de révision | | Same tokens (colours, fonts) declared once in a Typst theme file |

**Design tokens (proposal, D-08).** Primary `#B11649` (the raspberry the owner set on this workspace's title bar) with a dark-mode variant `#E0567F`; neutrals on a slate scale; status colours green/amber/red **always paired with an icon and a label** (colour never carries meaning alone); radius `0.5rem`; 4-pt spacing. The house violet `#6A1DE0` is the alternative if lfsci should look like the other Nolan products.

**Screens (UX-01, UX-02, UX-06).** Home "Ce qui nécessite mon intervention" (cards with why, what blocks, proposed action, expected effect; situation banner with controls done / partial / sources unavailable); Patrimoine, Locations, Finance, Travaux, Inbox, Échéancier, Documents; the assistant as a lateral `Sheet` opened from a trigger in the header (no floating button, per `ux.md`); the capture button in the page flow on mobile. Filters live in the view header with visible chips; absent data renders `—`.

## 10. Security and tenancy

- **Sessions:** better-auth httpOnly, `Secure`, `SameSite=Lax` cookies; passkeys and TOTP for the owner and any privileged role (SEC-02). No tokens in `localStorage`.
- **Authorisation:** better-auth organization roles carry the role (spec §3). The decision is one table in `apps/web/src/server/rpc/policy.ts`, keyed by procedure path and by the contract's HTTP method (GET is a read, anything else a write), applied once at the router root by the `authorize` middleware and by the assistant stream route, so an unlisted procedure is closed by default. Built 2026-09-20 after a review found every member had the owner's rights. Not yet there: the finer axes (legal entity, property, data nature), a partner reader's own current account (needs a membership → person link, question 50), and the 404-instead-of-403 answer (a refusal is a `FORBIDDEN` today).
- **RLS** as the second wall (§4). Migrations run as a DDL role; the app role has DML only (GLA lesson: grants next to the `CREATE TABLE`).
- **Secrets:** `.env` on the server, `chmod 600`, every required variable interpolated as `${VAR:?}` in compose; hex secrets; Odoo keys and integration tokens encrypted at rest; rotation documented per integration.
- **Uploads:** §8. **Webhooks:** signature verification (Svix for Resend, provider-specific for smsmode), raw-body integrity, timestamp window, replay dedup on provider id, quarantine of invalid messages without logging their content (INT-01).
- **Headers:** strict CSP with nonces (Next.js 16 supports it in `proxy.ts`), HSTS from Traefik, no inline scripts.
- **Audit:** `audit_log` (§4) for every mutation, read of sensitive documents, export and permission change (SEC-03).
- **Prompt injection (IA-02):** documents and messages are passed as data blocks; tool schemas have no free-text routing fields; the assistant cannot approve anything; QA-03 includes an adversarial document set.

### 10.1 Debuggability and front/back contract verification

Owner requirement (2026-09-19): front and back are both TypeScript, a request that type-checks must work the first time, and a problem must be locatable from one identifier.

- **One wire contract.** `packages/contracts` holds every request, response, domain event and job payload as a Zod 4 schema. oRPC procedures are declared from those schemas, the OpenAPI document is generated from them, and the same files are imported by the client, the server, the worker and the tests. A field cannot exist on one side only.
- **Validated at both ends.** The server validates every input, always. In `development` and `test` it also validates its own outputs against the response schema before sending, and the oRPC client re-parses responses with the same schema. Contract drift fails on the developer's machine and in CI, never in production.
- **Contract tests.** A Vitest project calls every procedure through the real oRPC router with fixtures from `packages/contracts/fixtures`, asserting the success shape and each declared error code. Playwright covers the browser path end to end.
- **Correlation id everywhere.** The web app generates a UUIDv7 `request_id` per inbound request (or accepts the client's `x-request-id`). oRPC context carries it; pino child loggers bind it; it is written on `command`, `command_attempt`, `outbox_entry`, `audit_log`, `inbox_item` and on every pg-boss job's data, so the worker inherits it; the Odoo operation reference embeds it; error responses return it; GlitchTip events are tagged with it; the UI prints it as `Référence : …` on every error. `traceparent` follows the same path when OpenTelemetry tracing is enabled.
- **Typed errors.** Every error crossing the wire is `{ code, message, details?, requestId }`, with `code` from a closed enum in `packages/contracts/errors.ts` mapped once to an HTTP status and once to a French message. No untyped `throw` reaches a handler boundary; anything unknown becomes `INTERNAL` with the id and is reported.
- **Raw exchanges kept, redacted.** Every inbound webhook and every outbound integration call stores request and response (headers and body, secrets and personal data removed by one shared redactor) in `integration_exchange` with the correlation id, 30-day retention and a restricted role. A development-only command replays an inbound item or a job from its stored payload.
- **Boundary lint.** `server-only` on every module under `apps/web/src/server`; ESLint `no-restricted-imports` forbids client components from importing server modules and forbids any package except `packages/integrations/odoo` from importing the Odoo client.
- **Strict TypeScript.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`; exhaustive `switch` statements closed with `satisfies never`; environment variables parsed by a Zod schema and imported lazily (`dev-environment.md`).
- **Ops screen in the app.** `/admin/ops` lists commands by state, attempts with error code and id, jobs read from the pg-boss tables, integration health and the last nightly report, searchable by correlation id. It is the "tableau d'exploitation" of spec OPS-01 and the first place to look, before any log.
- **Definition of done for a feature:** contract, server, client, contract test, e2e, and the "break it on purpose" check proving the test fails when the code is wrong.

If a physically separate backend service is ever preferred over Next.js route handlers, the same contracts and oRPC router mount on Fastify unchanged; the boundary above is what matters, not the process count.

## 11. Operations

### 11.1 Production compose (`docker-compose.prod.yml`, project name `lfsci`)

| Service | Image | Memory limit (initial) | Notes |
|---|---|---|---|
| `lfsci-web` | built, Next.js standalone, `node:24-alpine` | 512M | Traefik router `lfsci-web`, `Host(\`app.lfsci.fr\`)` (domain: D-09), middleware `lfsci-redirect` prefixed to avoid the `redirect-to-https` collision seen on this host |
| `lfsci-worker` | built, same repo, Typst binary included | 384M | No ports; scaled to one replica (pg-boss singleton keys make a second replica safe later) |
| `lfsci-db` | `postgres:18` + pgvector | 512M | `shared_buffers` sized after the RAM measurement; volume `lfsci-pgdata` |
| `lfsci-migrate` | same as worker, `profiles: [migrate]` | 256M | One-shot, `--exit-code-from` in `deploy.sh` |
| `lfsci-backup` | `postgres:18` client + S3 CLI | 64M | Hourly dump to `lfsci-backups` bucket, nightly full, retention 35 days |

Total initial budget ≈ 1.7 GB, to be confirmed against `free -h` on the box (§14). No host ports published; everything goes through Traefik. Health: `/healthz` (process up) and `/readyz` (Postgres, S3 and queue reachable), the latter is what Traefik's health check uses.

### 11.2 Deploy procedure

Clone under `~/docker/project/lfsci/`, `.env` from `deploy/env.prod.example`, then `scripts/deploy.sh`: `git pull --ff-only` → env check → `docker compose -f docker-compose.prod.yml build` → `run --rm lfsci-migrate` → `up -d --wait`. Never a bare `docker compose up`.

### 11.3 Observability

pino JSON on stdout (Dozzle already on the host); Sentry SDK pointed at the org GlitchTip DSN, PII scrubbed in the app before send; `beszel-agent` already on the host; nightly control report and integration health on the dashboard, not only in logs.

### 11.4 Database roles

Migration `0006_production_roles.sql`. Roles are cluster objects, so they are created once and every
environment uses the same four names; only the passwords differ.

| Role | Login | Attributes | Who connects as it | Rights |
|---|---|---|---|---|
| `lfsci` (owner) | yes | owner of the schema | `lfsci-migrate` only | DDL; creates the roles when they are absent |
| `lfsci_service` | yes | `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` | `lfsci-web` and `lfsci-worker` through `DATABASE_URL` | exactly `lfsci_app`'s, by membership |
| `lfsci_app` | no | DML only | nobody; `withTenant` runs `SET LOCAL ROLE lfsci_app` | `SELECT, INSERT, UPDATE, DELETE` per table, no `UPDATE`/`DELETE` on `audit_log`, no DDL |
| `lfsci_maintenance` | yes | `NOSUPERUSER BYPASSRLS` | the worker's admin handle and pg-boss through `DATABASE_ADMIN_URL` | `organization` read, `outbox_entry` lease reaping, `integration_exchange` purge, ownership of the pg-boss schema |

`lfsci_service` inherits `lfsci_app` rather than holding its own grants, so a code path that forgets
`withTenant` is still filtered by RLS instead of reading across tenants. `ALTER DEFAULT PRIVILEGES`
is set for the migration owner, so a table added by a later migration is reachable by `lfsci_app`
without a second grant; `CREATE` on `public` is revoked from `PUBLIC`, so neither login role can run
DDL. `packages/db/tests/db/roles.test.ts` proves both.

Passwords enter a fresh cluster through `docker/db/init/10-application-roles.sh`
(`APP_DB_PASSWORD`, `MAINTENANCE_DB_PASSWORD` from `deploy/env.prod.example`); on an existing
cluster the operator sets them with `ALTER ROLE ... PASSWORD`. Migrations keep running as the owner:
`lfsci_maintenance` has no DDL on `public` and cannot apply them.

### 11.5 Public-route rate limits

`apps/web/src/server/rate-limit.ts` is an in-process token bucket keyed by route and client address
(first hop of `x-forwarded-for`), applied to the Resend webhook, the assistant stream and the
authentication `POST` routes. Budgets are `RATE_LIMIT_WEBHOOK_PER_MINUTE`,
`RATE_LIMIT_ASSISTANT_PER_MINUTE` and `RATE_LIMIT_AUTH_PER_MINUTE`; a refusal answers 429 with
`QUOTA_EXCEEDED`, `retry-after` and the correlation id. The budget is per process, so a second web
replica doubles the effective ceiling — that is the day the bucket moves to Redis.

The CSP of `proxy.ts` was verified against a production build: every `<script>` the page emits
carries the nonce, which needs the nonce passed to next-themes as well, and
`upgrade-insecure-requests` is on outside development.

## 12. Development environment and commands

```bash
eval "$(fnm env)" && fnm use 24            # Node 24 pinned in .node-version
cp .env.example .env && npm install
npm run db:up            # PostgreSQL 18 + pgvector on 127.0.0.1:5434 (org port registry)
npm run db:migrate       # packages/db/migrations/*.sql, checksum-tracked
npm run db:seed          # one demo organization, SCI, two buildings, leases, loan, CCA, assets
npm run dev              # turbo: web on :3000, worker on :9090/healthz
npm run check            # biome + eslint (a11y, boundaries) + typecheck + vitest unit projects
npm run test:db          # RLS, audit chain, outbox, seed idempotence (needs TEST_DATABASE_URL)
npm run e2e              # playwright, desktop + iPhone, axe on every route
npm run db:pull          # regenerate the Drizzle schema after a migration (postpull breaks FK cycles)
npm run spec:docx        # uv run --with python-docx docs/build_spec.py
```

Conventions applied from day one: `.env` loaded file-relative (`apps/web/src/server/env.ts`, `tsx --env-file` for CLIs); `TEST_DATABASE_URL` required with no fallback for the db and worker test projects; "break it on purpose" for every new test file; the dev compose has its own `name: lfsci-dev`; `packages/db/src/generated/**` is pulled from the database and patched by `scripts/postpull.mjs` (tsvector column, the 36 cycle-closing foreign keys rewritten as column-level `references((): AnyPgColumn => …)`).

## 13. Build order

1. **Phase 0, week 1 — Odoo feasibility (POC-01/02).** Owner-side: confirm the plan (D-01), create a neutralised duplicate, create the bot user and API key with minimal rights, snapshot `/doc`. Code: the connector's read path, one supplier bill with attachment, one partial payment reconciliation, a closed-period refusal, a lost-response replay. Output: the connector contract with observed methods and payloads.
2. **Phase 0, week 1 in parallel — scaffold.** Monorepo, Next.js 16, Drizzle + first migration from `docs/schema/lfsci.sql`, better-auth with organizations, RLS, oRPC skeleton, Biome/ESLint/Vitest/Playwright, compose dev and prod, deploy script, GlitchTip DSN.
3. **MVP slice 1 — Patrimoine and personnes:** SCI, buildings, units, usage periods, people, documents with S3 upload and sandboxed viewer, timeline plumbing (`object_ref`, activity/event/deadline), capture PWA with the IndexedDB queue.
4. **MVP slice 2 — Baux and loyers:** leases, rent terms, payments and allocations, deposits, quittances and reçus in Typst, IRL with the INSEE feed, Odoo posting through the command pipeline, back-sync of reconciliations.
5. **MVP slice 3 — Dépenses, crédits, CCA, actifs:** receipt capture → Mistral OCR → Claude extraction → proposals; supplier bills to Odoo; loan schedules and instalment matching; CCA ledger; fixed assets read from Odoo; the eleven financial fixtures as automated tests against the neutralised duplicate.
6. **MVP slice 4 — Exploitation:** meters, equipment, maintenance, works projects, insurance, claims, charge keys and regularisation, Airbnb imports, inbox with email and SMS ingestion, nightly controls, dashboard, assistant.
7. **Hardening and migration (spec §21):** tenant boundary tests, restore drill, outbox replay test, data migration with reconciled opening balances, cut-over checklist.

Each slice ships with its docs updated in the same commit (`versioning-and-docs.md`), the full CRUD for every entity it introduces (`ux.md`), and its verification recorded in `CLAUDE.md`.

## 14. Unverified items and owner decisions

The living list, updated as the build progresses, is `docs/QUESTIONS.md`; the tables below are the state at design time.

### 14.1 To verify before the corresponding code

| Item | How |
|---|---|
| Odoo Online plan, version, Enterprise status, bot-user rights, actual `/doc` | Owner's account; Phase 0 |
| Odoo attachment path through JSON-2 | `/doc` on the duplicate; try `ir.attachment.create` with base64 `datas` |
| Odoo real rate limit | Ask Odoo support in writing; keep 1 req/s until then |
| Banque Populaire in Odoo's provider list; Indy export formats | Owner's Odoo and Indy accounts |
| Claude model availability in Bedrock `eu-west-3` | AWS model availability table for the account |
| Typst on a non-AVX CPU; `postgres:18` image with pgvector 0.8.2 | `docker run` both on the VPS |
| RAM, CPU, disk of `local-nolan-sarl` | `free -h`, `nproc`, `grep -c avx /proc/cpuinfo`, `docker stats --no-stream` |
| INSEE `portail-api.insee.fr` authentication for BDM | Create the developer account |
| IGN Géoplateforme geocoding endpoint paths | Read the guide at `cartes.gouv.fr`; smoke test |
| Airbnb transaction CSV headers in 2026 | Owner's host account export |
| Youtrust and Universign quotes at < 20 signatures/year | Sales contact (V2) |
| Serwist or hand-written service worker for the PWA shell on Next.js 16 | Spike during scaffold; keep the SW minimal |
| wal-g vs pgBackRest versions, when backups move to WAL archiving | Later; not needed at MVP volume |
| Next.js SSE through Traefik without buffering | Load test the assistant route |

### 14.2 Decisions for the owner

| Id | Decision | Recommendation |
|---|---|---|
| D-01 | Upgrade the Odoo Online subscription to Custom for API access | **Decided 2026-09-20:** Odoo Online kept for its native bank reconciliation, Custom plan to subscribe (€37.40/user/month monthly, €29.90 yearly, odoo.com/pricing-plan). Self-hosted Community with OCA modules was evaluated and rejected |
| D-02 | Bank feed path if Banque Populaire is unsupported by Odoo's providers | CAMT.053 or OFX import into Odoo; the SaaS reads Odoo |
| D-03 | Object storage provider | Scaleway `fr-par`; Garage on the box only if data must never leave it |
| D-04 | LLM | **Decided 2026-09-20: local Ollama** on the owner's GPU box as default provider; data never leaves the owner's hardware. Anthropic/Bedrock kept as an optional provider. Model choice and quality baseline open (`docs/QUESTIONS.md` item 5) |
| D-05 | Voice transcription vendor | Gladia; Voxtral if cost matters more than zero retention |
| D-06 | E-signature vendor (V2) | Quote Youtrust API v3 and Universign PAYG |
| D-07 | Malware scanning of uploads | Deferred; isolation and re-encoding at MVP; ClamAV when RAM allows |
| D-08 | Brand palette | Raspberry primary as proposed, or the house violet |
| D-09 | Production hostname | `app.lfsci.fr`; DNS record and Traefik router move together (org rule) |
| D-10 | GitHub repository and CI | **Decided 2026-09-20:** `noah-lnt/lfsci.fr`, GitHub Actions on every PR. Error reporting (GlitchTip) declined for now; `SENTRY_DSN` stays empty |
| D-11 | Embedding model, which pins the `embedding.vector` dimension | **Revised 2026-09-20 with the local route:** the default is Ollama `bge-m3` (`OLLAMA_MODEL_EMBED`), chosen because it is multilingual, which the French corpus needs, and because it is 1024-dimensional like `mistral-embed`, so migration 0001's `vector(1024)` is unchanged. **Unverified**: no instance was reachable from the build machine, so the model's width is asserted at call time and a mismatch is refused, never padded or truncated. The width is `AI_EMBED_DIMENSIONS`; changing it means a migration of `embedding.vector` and a re-index, and a second model needs a second table |
| D-12 | Overlap rules enforced by the database | Keep the exclusion constraints unless a legitimate overlap exists (a lease signed before the previous one ends, an equipment moved mid-day); each removal is a migration and a spec note |

## 15. Deviations from house conventions, with reasons

| Convention | Deviation | Reason |
|---|---|---|
| `ui-kit.md`: shadcn on Radix | shadcn on **Base UI** | shadcn's default since July 2026; starting a new project on the outgoing primitive means a component-by-component migration later |
| `prisma.md` house ORM | **Drizzle** | SQL-first migrations reviewed in git next to a ledger; `numeric` as string; Prisma's `latest` currently resolves to an 8.0 RC |
| kycone's BullMQ + Redis | **pg-boss** | Transactional enqueue with the outbox; one fewer stateful service on a RAM-bound host |
| kycone's MinIO | **External EU S3** | MinIO archived 2026-04-25 |
| `recharts.md` wrappers (v2 API) | **Recharts 3** | Port the wrappers; the v3 API changed axis and tooltip defaults |
| Products deploy without memory limits | **Every service has a limit** | Org rule; the host's headroom is unknown |
| Email via nodemailer in some products | **Resend only** | Org rule |
