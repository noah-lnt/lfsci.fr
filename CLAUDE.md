> STATUS: ACTIVE
@~/.claude/rules/nolan/org.md
@~/.claude/conventions/ui-kit.md
@~/.claude/conventions/ux.md

# lfsci.fr — AI-first property and rental management SaaS on top of Odoo Online

> **Off the showcase stack** (no Payload): a product. Next.js 16 + better-auth + oRPC · pg-boss worker · PostgreSQL 18 + pgvector · Drizzle · Zod 4 · Tailwind v4 + shadcn on Base UI · Anthropic SDK. Every pick is justified in `docs/tech-pack.md`; the functional spec is `docs/cahier-des-charges-gestion-patrimoniale.md` (French).

## Commands

Node 24 via fnm: `eval "$(fnm env)" && fnm use 24` first. All scripts are in the root `package.json` and run from any directory of the repo.

```bash
npm run db:up && npm run db:migrate && npm run db:seed   # dev PostgreSQL on 127.0.0.1:5434
npm run dev                                              # web :3000, worker :9090
npm run check                                            # biome + eslint + typecheck + unit tests
TEST_DATABASE_URL=postgres://lfsci:lfsci@127.0.0.1:5434/lfsci_test npm run test:db
npm run e2e                                              # playwright + axe (starts the dev server)
npm run db:pull                                          # regenerate packages/db/src/generated after a migration
npm run spec:docx                                        # rebuild the Word spec
```

## Structure

`packages/contracts` (the one wire contract; `tests/sql-parity.test.ts` proves every SQL CHECK enum matches its Zod enum) · `packages/kernel` (correlation id, `AppError` with the closed `ErrorCode`, logger, `parseEnv`, redaction; `@lfsci/kernel/redact` and `/ids` are the client-safe subpaths) · `packages/domain` (pure functions, fixtures F01–F11 as tests) · `packages/db` (`withTenant` = `SET LOCAL app.organization_id` + `SET LOCAL ROLE lfsci_app`; `migrations/*.sql` is the canonical DDL history, `docs/schema/lfsci.sql` is migration 0001; `src/generated/**` is pulled, never edited) · `packages/ai` · `packages/integrations/*` (each client takes an injected `fetch`; only `odoo` sees Odoo credentials, enforced by ESLint) · `apps/web/src/{lib/contracts,server/rpc/modules,i18n/messages}/<module>.*` (one file per feature module, assembled by `lib/contract.ts`, `server/rpc/router.ts`, `i18n/messages/index.ts`) · `apps/worker/src/jobs/*` (one file per queue, registered in `jobs/registry.ts`).

## Specifics

- **Money is a decimal string end to end** (`Money` in contracts, `numeric` in Postgres, decimal.js in domain); never `number`.
- **Commands, not writes, toward Odoo**: a mutation writes decision + `command` + `approval` + `outbox_entry` in one tenant transaction; the worker's `outbox.dispatch` is the only Odoo caller; `RESULT_UNKNOWN` is reconciled by operation reference, never retried blindly (tech pack §5).
- **Every request carries `x-request-id`** (UUIDv7) from `proxy.ts` through `runWithCorrelation` to jobs, exchanges and error payloads; the ops screen searches by it.
- **Dev DB user is a superuser**: RLS is only exercised because `withTenant` switches to `lfsci_app` (migration 0004 grants it). Tests that skip that switch prove nothing.
- **Odoo Online stays the ledger (owner decision 2026-09-20), chosen for its native bank reconciliation; the API needs the Custom plan.** Self-hosting Community with OCA modules was evaluated and rejected; do not propose it again unless the owner reopens it.
- **Owner decisions 2026-09-20:** messaging is **email only, through Resend**; there is no SMS channel (the smsmode package and webhook were removed, inbound SMS arrive as pasted notes). The LLM is a **local Ollama instance** on the owner's GPU box (`AI_PROVIDER=ollama`); the Anthropic/Bedrock path stays available but is not the default. Production runs on the **owner's dedicated Debian server**; dev is the MacBook Pro.
- Spec and research notes stay in French; code, commits and docs in English. Phase 0 (spec §21.1) runs on a neutralised Odoo duplicate, never the live base.
- Owner questions and unverified vendor details are tracked in `docs/QUESTIONS.md`; a technology change is a tech-pack edit plus a spec history line.

## Verify

`npm run check` green, `npm run test:db` when touching SQL, tenancy, audit or outbox, `npm run e2e` for any screen, `npm run build -w @lfsci/web` before a deploy. Break a check on purpose once per new test file and confirm it fails. Schema edits: new migration + `npm run db:pull` + the contracts parity test.
