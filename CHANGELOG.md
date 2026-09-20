# Changelog

## Unreleased

### Added

- Specification v1.2 (French), tech pack v1, physical PostgreSQL model with invariant tests, owner questions in `docs/QUESTIONS.md`.
- Monorepo scaffold: Next.js 16 web app, pg-boss worker, shared packages (contracts, kernel, domain, db, ai, integrations), Biome + ESLint a11y, Vitest, Playwright with axe, Turborepo, CI workflow.
- Dev database on PostgreSQL 18 with pgvector (`npm run db:up`), checksum-tracked SQL migrations (init, auth, integration exchanges, app role grants, fail-closed tenant setting), generated Drizzle schema with a post-pull patch for cyclic foreign keys.
- Contracts: 138 enums proven equal to the SQL CHECK constraints, entity read models, command envelopes with decision levels, approvals, API shapes, fixtures.
- Domain: rent terms, IRL revision, payment allocation and receipt kind, charge allocation and regularisation, loan schedules, deposits, CCA ledger, depreciation, cash bridge, Airbnb payouts; fixtures F01–F10 and T-F11 as tests.
- Db runtime: tenant transactions with RLS and app role, object registry links, hash-chained audit log, idempotent commands, approvals, outbox with SKIP LOCKED claims, external references, redacted integration exchanges, seed.
- Integrations (the SMS channel was evaluated and removed on the owner's decision): Odoo JSON-2 client with rate limit, typed operations, capability snapshot and fake server; S3 storage with local dev driver; Mistral OCR; Gladia; Resend outbound and inbound with Svix verification; INSEE, ADEME, IGN open data; Typst PDF templates.
- AI: Claude client (Bedrock or first-party), extraction schemas with evidence and confidence, French assistant with propose-only tools.
- Worker: outbox dispatch and reconcile, document analysis, inbound email, voice transcription, monthly rent terms, nightly controls, deadlines, Odoo back-sync, PDF rendering, IRL refresh.
- Web: better-auth with organizations and TOTP, correlation id on every request, oRPC contract-first API with OpenAPI, design system on Base UI, screens for Accueil, Patrimoine, Documents, Locations, Finance, Travaux, Inbox, Échéancier, Validations, Ops, and the assistant panel.
- Production compose for `local-nolan-sarl` with memory limits, one-shot migrate service, hourly backups to S3, deploy script.
