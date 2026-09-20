# Coding plan — from PR #1 to a first month of real use

Written 2026-09-20 against the state of `feature/scaffold` (CI green). Sizes are relative, S under a day of agent work, M one to two days, L three to five; nothing here is a calendar promise (tech pack §13). Each slice ends with its own verification and its docs updated in the same PR (`versioning-and-docs.md`). Requirement ids refer to the spec; `D-nn` to the tech pack §14.2; numbered questions to `docs/QUESTIONS.md`.

## 0. Owner prerequisites, without which slices 1 and 5 cannot start

| # | Action | Unblocks |
|---|---|---|
| P1 | Subscribe the Odoo Online database to the **Custom** plan (D-01) | slice 1 |
| P2 | Duplicate the database "for testing" (external actions disabled), create a bot user with accounting rights only, generate its API key, note the database name | slice 1 |
| P3 | Export `/doc` of the duplicate and the list of journals, the bank journal's account, the chart accounts used for rent (706/708), provisions (487 or 708), deposits (165), CCA (455) — the accountant confirms | slice 1 |
| P4 | Decide the operation-reference field name in Odoo (Studio text field on `account.move`, `res.partner`, `account.bank.statement.line`, `ir.attachment`; default `x_lfsci_ref`) | slice 1 |
| P5 | `ollama pull qwen3:32b` and `qwen3.5:27b` on the GPU box; expose it to the Debian server over a private network or a TLS proxy with `OLLAMA_API_KEY` (question 5) | slice 3 |
| P6 | On the Debian server: `free -h`, `nproc`, `grep -c avx /proc/cpuinfo`, disk, whether Traefik with the `web` network exists; a DNS record for the app host (D-09) | slice 5 |
| P7 | Scaleway Object Storage: two buckets and an API key (D-03); Resend domain with the `inbound` MX (question in §2); Mistral API key | slices 2, 5 |
| P8 | Answers to questions 8, 9, 15, 16 (charge natures, depreciation policy, approval expiry, who approves) | slices 2, 4 |

## 1. Phase 0 on Odoo Online 19 and the rent pipeline — L

Goal: `prepare_rent_accounting` and `post_supplier_bill` reach the real ledger; a lost response is reconciled; a locked period is refused before the call.

1. `scripts/odoo-poc/run.ts` gains a `json2` profile and runs against the duplicate: the same ten steps as the local run, plus Studio field presence, plus `account.bank.statement.line` reads (I2, I4). Output committed as `docs/odoo-poc-online.md`. Every "to confirm" marker in `packages/integrations/odoo` is resolved or kept with the measured reason.
2. Connector: `readLockDates(company)` and a pre-flight `assertPeriodOpen(date)` used by every posting operation; `createDraftCustomerInvoice` finalised with the confirmed accounts and the analytic distribution per lot (spec FIN-01, the unit's analytic account created on first use through `account.analytic.account`).
3. Worker `outbox.dispatch`: map `prepare_rent_accounting` → customer invoice + post, `issue_receipt` → attach the Typst PDF to the move, `attach_document_to_odoo`, `record_cca_movement` → journal entry on 455 (accountant-validated template), `post_supplier_bill` with the analytic split from `expense_allocation`. Remove the `no_typed_operation` refusal only for mapped types.
4. Expected-version re-check before send (worker question 2): a `versionOf(objectRef)` lookup per `object_ref.kind` for lease, rent_term, expense, cca_movement.
5. `odoo.backsync`: map `account.move` and `account.bank.statement.line` back to `rent_term`, `payment`, `expense` through `external_ref`; a reconciliation seen in Odoo creates the `payment` + `payment_allocation` rows the SaaS shows (LOY-02 authority: Odoo); a manual change in Odoo opens an exception (SYN-05).
6. Tests: the eleven financial fixtures (spec §21.2) executed against the duplicate as an opt-in vitest project `odoo-online` (skips without `ODOO_*`); replay of imports and commands with 0.00 additional variation; the fake server updated with every payload shape measured.

Verification: the fixture run against the duplicate, `docs/odoo-poc-online.md`, and a Validations → outbox → confirmed round trip in the UI with the command's Odoo number displayed.

## 2. Close the MVP functional gaps — L

Screens and rules the spec marks MVP that the branch does not have yet, in the order the owner meets them.

| Slice | Requirement | Scope | Size |
|---|---|---|---|
| 2a | EDL-01..03, EDL-02 inventory | `inspection`, `inspection_finding`, `inventory_item`: mobile room-by-room form, photos through the capture queue, entry/exit comparison, deposit settlement via `settleDeposit`; contracts + module + pages `/locations/baux/[id]/etats-des-lieux` | L |
| 2b | LOY-04 arrears | Overdue detection job, graded reminder templates (email via Resend, MSG-01 policy: routine reminders level C, mise en demeure level D), suspension rules, cards on Accueil | M |
| 2c | CHA-02 regularisation | `provision_regularization_run` UI: freeze expenses and keys, compute per tenant with `regulariseProvisions`, statement PDF (Typst `decompte`), command `issue_receipt`-like for the adjustment | M |
| 2d | IRL-01 completion | `irl.refresh` wired to the revisions tab, notification letter PDF, `revise_rent` execution after approval updates `rent_term_version` from the effective date | S |
| 2e | ASS-01, SIN-01 | Insurance policies with expiry deadlines and attestation matching from the inbox; claims with linked expenses and indemnities; pages under `/patrimoine` and `/travaux` | M |
| 2f | AIR-01..03 | Listings, bookings, payouts: CSV import mapped by header name, iCal read, payout reconstruction with `expectedPayout`/`matchPayout`, page `/locations/courte-duree` | M |
| 2g | IMM-01, CRE-02, BAN-01 | Assets and loan balances read from Odoo through the back-sync; bank balances read from Odoo (question 14) so "trésorerie" stops rendering `—` | M |
| 2h | ACQ-01 | Opportunity with scenarios and the single conversion command | M |
| 2i | IA-06, MEM-01/02 UI | Rule proposals from repeated confirmations shown on Inbox; a search page over `search_document` with sources and dates; the indexing worker that fills `search_document.tsv` and `embedding` through Ollama embeddings (D-11: `mistral-embed` was chosen when Mistral was the residency answer; with Ollama local, pick an Ollama embedding model of the same dimension or migrate the column) | M |
| 2j | Read models for the ~30 secondary tables (contracts gap) | Entities and API shapes so the UI stops reading raw tables | M |

Each slice: contract + module + i18n + page + e2e with axe, full CRUD (`ux.md`), one break-it-on-purpose per new test file.

## 3. Local AI in production shape — M

1. Eval set (spec IA-04): 30 real receipts, 20 invoices, 10 attestations, 10 leases supplied by the owner, redacted; a vitest project `ai-eval` (opt-in) scoring critical fields and **evidence** (the live test showed invented bounding boxes on text-only input); a `docs/ai-eval.md` table per model.
2. Worker `document.analyze`: rasterise PDFs to page PNGs for the vision model (`pdftoppm` in the worker image, or `pdfjs-dist` if a pure-JS path is preferred; measure both) so Ollama sees pages, not only OCR text; recompute sha256 server-side (question 22 note).
3. `checkOllama` wired into the worker health and `/readyz`; the Accueil banner shows "modèle indisponible" from it.
4. Optional local OCR: measure Ollama vision on receipts against Mistral OCR; keep Mistral only if the eval says so, otherwise drop the paid dependency.
5. Embeddings through Ollama (`/api/embed`), dimension aligned with the schema (2i).

## 4. Hardening before real data — M

1. Production database roles: a non-superuser app role, `lfsci_app` DML only, a `BYPASSRLS` maintenance role for `forEachOrganization` (question 39); migration + `docker/db` init.
2. Auth: TOTP enrolment UI; passkeys when better-auth ships the plugin without extra packages; approval expiry and approver roles per questions 15 and 16.
3. Webhook and route rate limits (Resend inbound, assistant SSE); CSP verified in production mode; `upgrade-insecure-requests` on.
4. RGPD-01..05: retention matrix as `rule` rows, purge jobs (audio after transcription, exchanges after 30 days, candidatures), per-person export and pseudonymisation propagated to OCR text, embeddings, thumbnails; a `docs/rgpd.md` register.
5. A11y refactor: the 14 navigation buttons become `<Link className={buttonVariants()}>`; dark-mode contrast pass with the same axe helper; keyboard walk of the capture flow.
6. Durable offline capture queue (UX-03): IndexedDB with foreground flush; Playwright test with network offline then online.
7. `claimOutbox` channels used by an `email` dispatcher for MSG-01 outbound mail (receipts, reminders) with the outbox trace written before the send.

## 5. Production on the Debian server — M

1. Measure (P6) and size `deploy.resources.limits.memory`; if no Traefik exists, add `deploy/traefik/` (compose with `web` network, `websecure`, `letsencrypt`, docker-socket-proxy, memory limit) as the org runbooks describe.
2. `scripts/deploy.sh` run end to end: clone under the owner's chosen path, `.env` from `deploy/env.prod.example`, build on the server, migrate, `up -d --wait`, `/readyz` green from outside, Typst render of a quittance inside the worker container (question 38), backup upload to the second bucket and one restore drill into a scratch database (BCP-01).
3. Odoo production credentials: the live database only after the duplicate run of slice 1 is green and the accountant signed the mapping (POC-01/02).
4. `docs/runbook.md`: deploy, rollback (`git checkout <tag>` + redeploy, migrations are forward-only), backup restore, secret rotation, Ollama outage behaviour.

## 6. Migration of the owner's data and go-live — M

1. MIG-01 inventory: Odoo exports (partners, invoices, bank lines, assets, loans), the owner's spreadsheets for leases and meters, Airbnb CSVs. A dry-run import command (`scripts/migrate/`) prints counts, rejects, proposed matches and totals per company; historical rows are flagged `import` so no reminder fires (TMP-04).
2. MIG-02 opening balances reconciled against Odoo at one date with the accountant: tenant balances, deposits, loans, CCA, bank, VNC.
3. MIG-03 cut-over: date fixed, old rent generator stopped, one full monthly cycle watched (WF-02), the owner signs the deviation report.
4. Definition of done (spec §21.5): zero P0, the financial and rights scenarios passed, restore demonstrated, the documentation set present.

## 7. Cross-cutting rules for every slice

- Owner decisions are edited in `docs/QUESTIONS.md` first, then the code follows; a technology change is a tech-pack row plus a spec history line.
- No slice merges with a red gate: `npm run check`, `npm run test:db`, `npm run e2e`, and the opt-in Odoo and AI projects when their credentials exist.
- Money stays a decimal string, commands stay the only path to Odoo, the correlation id stays on every request and job.
- Each slice is one PR per logical topic on a `feature/<slice>` branch from `main`, created `--no-track`, pushed with `-u`.

## 8. Suggested order and parallelism

Slice 1 first, alone, because everything financial depends on it and it needs the owner's Odoo work (P1–P4). Slices 2 and 3 run in parallel after it (different packages: web modules versus `packages/ai` + worker). Slice 4 follows 2 and 3. Slice 5 can start as soon as P6 is answered, in parallel with 2 and 3, and must be finished before 6. Slice 6 is last and is done with the accountant, not alone.
