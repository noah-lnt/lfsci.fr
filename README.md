# lfsci.fr

AI-first property and rental management SaaS for a French SCI. Odoo Online stays the accounting ledger; this app is the daily interface: patrimoine, baux, loyers, dépenses, crédits, comptes courants d'associés, travaux, documents, inbox, échéancier, assistant.

The functional spec (French) is `docs/cahier-des-charges-gestion-patrimoniale.md`; the technical design is `docs/tech-pack.md`; the physical data model is `docs/schema/lfsci.sql` (migration 0001) and `packages/db/migrations/`.

## Prerequisites

Node 24 (`.node-version`, use `fnm use`), npm 11, Docker Desktop, `uv` (only to regenerate the Word spec), `typst` (only to render PDFs locally; the worker image installs it).

## Getting started

```bash
cp .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

The web app listens on http://localhost:3000, the worker on http://localhost:9090/healthz. Sign up on `/inscription`: the first user creates the organization. Without object-storage credentials in `.env`, uploads go to `apps/web/.storage/` through a local driver; without AI, OCR, mail or SMS credentials, the corresponding jobs finish with `sources_unavailable` and the assistant answers that the service is unavailable.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | web + worker in watch mode (Turborepo) |
| `npm run check` | Biome, ESLint (a11y + module boundaries), typecheck of every workspace, unit tests |
| `npm run lint` / `npm run typecheck` / `npm test` | the individual gates |
| `npm run test:db` | database tests (RLS, audit chain, outbox); needs `TEST_DATABASE_URL` |
| `npm run e2e` | Playwright on desktop Chrome and iPhone, with axe on every route |
| `npm run db:up` / `db:down` / `db:reset` | dev PostgreSQL 18 + pgvector on `127.0.0.1:5434` |
| `npm run db:migrate` | applies `packages/db/migrations/*.sql` (checksum-tracked) |
| `npm run db:seed` | idempotent demo data |
| `npm run db:pull` | regenerates the Drizzle schema from the database |
| `npm run build -w @lfsci/web` / `-w @lfsci/worker` | production builds |
| `npm run spec:docx` | rebuilds the Word spec from the Markdown |

## Repository

```
apps/web            Next.js 16, better-auth, oRPC (contract-first), Tailwind v4 + shadcn (Base UI)
apps/worker         pg-boss jobs: outbox to Odoo, OCR + extraction, inbound mail/SMS, nightly controls, PDF
packages/contracts  the one wire contract (Zod 4): entities, commands, approvals, API shapes, fixtures
packages/kernel     correlation id, typed errors, logger, env parsing, redaction
packages/domain     pure financial rules (rent terms, IRL, allocations, loans, deposits, CCA, assets)
packages/db         Drizzle runtime: tenant transactions (RLS), audit chain, commands/outbox, migrator, seed
packages/ai         Claude via the Anthropic SDK: extraction schemas, assistant tools (propose only)
packages/integrations/{odoo,storage,ocr,speech,mail,sms,opendata,pdf}
docs                spec, tech pack, schema, research
```

## Production

One VPS behind Traefik: `docker-compose.prod.yml` (web, worker, db, backup, one-shot migrate), configured from `deploy/env.prod.example`, deployed with `scripts/deploy.sh`. Details in `docs/tech-pack.md` §11.
