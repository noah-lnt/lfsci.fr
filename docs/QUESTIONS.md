# Questions for the owner

Collected during the autonomous build of 2026-09-20. Each item names what was assumed in the code so the build could continue, and what your answer changes. Answer inline, or reply with the item numbers. Decision ids `D-nn` refer to `docs/tech-pack.md` §14.2.

## 1. Blocking before the first real run

1. **Odoo Online plan (D-01) — decided 2026-09-20.** The owner keeps Odoo Online for its bank reconciliation; self-hosted Community was considered and rejected. The external API is a Custom-plan feature: €37.40 per user per month billed monthly, €29.90 billed yearly on odoo.com/pricing-plan as of 2026-09-20. Remaining action: subscribe to Custom, then create the neutralised duplicate and the bot API key for Phase 0.
1b. **Phase 0 on a local Odoo 18 Community + OCA, run 2026-09-20 (`docs/odoo-poc.md`).** 9 of 10 steps pass through the real connector: tenant, posted rent invoice (`out_invoice`, accounts 708300 and 706000), PDF attachment, CAMT.053 import, full and partial reconciliation via the OCA widget's server methods, lost-response recovery, 137 reads/s. Finding to act on whatever the hosting: **Odoo does not refuse a posting in a locked period, it silently moves the accounting date** past the lock; the SaaS must read the company lock dates and refuse before calling (spec WF-12). Open: which groups the bot user gets (it could not set lock dates, trust a bank account or read `ir.model`), who creates the `x_lfsci_ref` fields on Online (Studio), and whether Ponto at about €10/month beats one manual CAMT download a month. Self-hosting's real cost is the yearly OpenUpgrade of Odoo plus 312 OCA modules, with no 19.0 branch yet for the two reconciliation repositories. **Acted on 2026-09-20:** the connector reads the company lock dates and refuses locally before any posting call, and it compares the posted accounting date with the one asked for, so a shift Odoo makes anyway surfaces as `PERIOD_LOCKED` with the move id instead of a silent misdating. One more finding for the bot user's group list: it also needs **Technical/Analytic Accounting**, without which it cannot read `account.analytic.plan` and cannot create the per-unit analytic accounts (or `ODOO_ANALYTIC_PLAN_ID` must be set).
2. **Rent terms now reach Odoo — against the fake server and the local Odoo 18 only.** `prepare_rent_accounting`, `issue_receipt`, `record_cca_movement` and `post_supplier_bill` are mapped in the dispatcher: a rent term becomes a posted `out_invoice` with one line per part (rent, provisions, accessories), the unit's analytic distribution, and the operation reference on the move. What still waits on you: the Custom plan and the duplicate database, so the same run can be repeated against Odoo Online 19; and the accountant's answer on item 8b below. The owner's live or duplicate database has **not** been called.
3. **Bot user and `/doc` snapshot.** Create a bot user with minimal rights on the duplicate, generate an API key, and export `/doc`; the connector's capability snapshot comes from it.
4. **Stable reference field in Odoo.** A Studio text field on `account.move` (default name `x_lfsci_ref`, indexed, not unique) carries the operation reference used to reconcile lost responses. Confirm the name.
5. **LLM (D-04) — decided 2026-09-20, implemented.** A local Ollama instance on the owner's GPU box is the default provider (`AI_PROVIDER=ollama`); residency is solved by keeping data on the owner's hardware, and the Anthropic/Bedrock path stays selectable. Open: (a) **the models** — the defaults are `qwen3:32b` for text and `qwen3.5:27b` for vision, both Q4 in the 32 GB card, but neither has been run on real documents; confirm or replace, and `ollama pull` them on the box; (b) **the base URL reachable from the Debian server** (`OLLAMA_BASE_URL`), plus whether it crosses the public internet — if so it needs TLS and `OLLAMA_API_KEY` on a proxy in front, since Ollama itself has no authentication; (c) **the quality baseline** on real receipts before any automation (spec IA-04): a first pass on a 3B model returned correct supplier, ISO date, totals and lines but invented `evidence.bbox` coordinates, so the evaluation set has to score evidence as well as values; (d) **PDF handling** — Ollama reads page images, not PDF bytes, so `document.analyze` has to rasterise pages (it currently forwards `pdfBase64`) or every PDF returns `unsupported_input` on the local route; (e) whether the GPU box also hosts the vision model at the same time or whether Ollama should swap models between calls (a 32 GB card holds one of the two defaults at a time).

6. **Object storage (D-03).** Scaleway `fr-par` bucket credentials, or Garage on the box. Without credentials the dev build uses a local driver.
7. **Palette (D-08).** Raspberry `#B11649` is implemented from your workspace colour; the house violet is the alternative. Confirm before more screens are styled.

## 2. Accounts and credentials to open

- Odoo Online: Custom plan, duplicate database, bot API key.
- Scaleway Object Storage: two buckets (documents, backups), API key.
- AWS Bedrock in `eu-west-3` with Claude Opus 5 enabled, or an Anthropic API key.
- Mistral (OCR, EU endpoint) API key.
- Gladia API key. Note: Gladia documents no region selector on its v2 endpoint; French-infrastructure processing is a contractual statement to check, not an API setting.
- Resend: domain with the `inbound` MX record and a webhook secret.
- INSEE `portail-api.insee.fr` developer account (IRL series `001515333`); the auth scheme is unverified.
- Error reporting is optional: with `SENTRY_DSN` empty nothing is sent anywhere and errors stay in the logs and the ops screen. Decided 2026-09-20: not needed for now. The repository is `noah-lnt/lfsci.fr`.

## 3. Decisions per area

### Finance and accounting
8. **Charge natures.** `expense_line.charge_nature` is free text with no list anywhere in the schema. The accountant must provide the validated vocabulary (spec CHA-01); the capture form has no dropdown until then.

8b. **Chart accounts, coded as configuration, none confirmed.** The connector now takes its accounts from `ODOO_ACCOUNT_*` (see `.env.example`); the defaults are the French-chart codes measured on the local instance (`docs/odoo-poc.md`, §Measured for slice 1): rent `708300`, provisions `706000`, accessories `708800`, deposits `165100`, partner current account `455100`, its counterpart `471000`, receivable `411100`. **The accountant must confirm each one**, and in particular whether rent belongs on 708300 (locations diverses) or 706000 (prestations de services) — Phase 0 used 708300 for rent and 706000 for provisions, and the code follows that. Changing an account is an env change, not a deploy of new code.

8c. **Partner current account entry — template invented, needs the accountant.** A `record_cca_movement` posts a two-line journal entry in the first `general` journal: the 455 account on one side, `ODOO_ACCOUNT_CCA_COUNTERPART` on the other, dated on the movement's `occurred_on`, with the partner on the 455 line. The counterpart defaults to the **suspense account 471000** precisely so an unreviewed entry is visible in the books rather than plausible. The sign follows item 12: contribution, expense paid personally and interest credit the 455; repayment and offset debit it; a correction follows the sign of its amount. To confirm: the real counterpart per movement kind (bank 512 for a contribution received by transfer? the expense account for an expense paid personally? 661 for interest), the journal, and whether these entries should be posted at all or left in draft for review.

8d. **A rent invoice is dated on the term's due date**, for both `invoice_date` and the accounting date, and its Odoo `ref` is `<lease reference> <period start>`. The alternative is the period start. Confirm which date the accountant expects to see in the ledger.
9. **Depreciation policy — partly coded 2026-09-20.** The register uses straight-line depreciation with a duration entered per asset; when none is entered it falls back to 30 years for a building, 15 for works, 10 for equipment and never depreciates land, and every row and total built on a fallback says `durée par défaut`. The land/construction split is entered per asset (`land_value`) and never inferred, as IMM-02 requires. Still yours: confirm or replace the three fallback durations, and say whether works are capitalised into the asset at conversion (today the gross value is price plus estimated fees only).
10. **Loan insurance — coded 2026-09-20.** The rule is chosen per loan at creation (`loan.insurance_basis`, migration 0008), defaults to the initial principal because that reproduces the schedules already stored, and shapes the computed schedule. The screen also reads the rule back from the stored premiums: when the stored rule and the observed premiums disagree, the loan page says so in red instead of hiding it, since an imported lender schedule is the usual cause. Rates are entered as percentages (`1.45` = 1,45 %). Still yours: for each existing loan, which rule your bank applies.
11. **Loan deferral.** `partial` pays interest and insurance with capital intact; `total` capitalises interest. Monthly fees only, no upfront fee line.
12. **CCA movement kinds.** `offset` is treated as a repayment and `correction` as a signed contribution.
13. **Forecast.** Expenses carry no due date; an unsettled expense weighs from today.
14. **Bank balance — decided and coded 2026-09-20.** The ledger is the authority: the back-sync copies each bank journal's `current_statement_balance` (measured on Odoo 18 Community, an `account.journal` monetary field) into `bank_account.odoo_balance`, dated by the last statement line mirrored for that account. The screens show that figure with its date and label it `ledger`; when the ledger has not answered yet they fall back to the opening balance plus mirrored movements, labelled `computed` or `opening_only`, and nothing renders without its label. Still yours: each bank account's `odoo_journal_id` (the journal it maps to in Odoo), without which no balance is copied.
15. **Approval expiry** is 24 hours. A Friday-evening proposal expires before Monday. Keep, or extend to 72 hours?
16. **Who may approve.** Only `owner_admin`; a `delegated_manager` cannot approve anything. Intended?
17. **Decision levels not named by the spec.** `attach_document_to_odoo` = B, `propose_reconciliation` = C.

### Leases and rent
18. **DPE freeze overseas.** F/G blocks a revision in métropole only; overseas dates differ. Block too, and from when?
19. **Deposit restitution deadline.** Counted in calendar months from key handover; a 31st clamps to the 28th. Accepted?
20. **First partial month.** When the due day has already passed at lease start, the term is due on the period start. Confirm.
21. **Rounding.** ROUND_HALF_UP at the cent; multi-way splits use the largest remainder with ties on ascending id (spec T-F06). Flat charges are excluded from regularisation (CHA-02).
22. **Document nature list** shipped: `to_qualify`, `invoice`, `lease`, `receipt`, `photo`, `report`, `insurance`, `other`; every capture starts at `to_qualify`. Validate.
23. **Deletion.** The schema has no delete path; archiving by status is the fourth CRUD verb.

### AI
24. **Model per route.** `claude-opus-5` everywhere. Bulk extraction on `claude-sonnet-5` should be measured on your real receipts before being chosen (spec IA-04 needs that baseline).
25. **Redaction floor.** Digit runs of 14 or more are masked before text reaches the model. Any real policy or meter number longer than 13 digits?
26. **Inbox uncertainty note.** `whyUncertain` is required even on confident items. Keep?
27. **Prompts.** Extraction prompts are English over French documents; the assistant speaks French.

### Data and tenancy
28. **Several SCIs in one organization** is allowed by the schema (spec §2); consolidation stays V2. Inbound webhooks carry no tenant: with more than one active organization a message is refused (`AMBIGUOUS_REFERENCE`). A per-organization inbound address or secret is needed before a second SCI.
29. **Overlap rules (D-12).** Exclusion constraints forbid overlapping usage periods, main lease units and equipment assignments. Keep unless a legitimate overlap exists.
30. **`person` holds tenants, partners, guarantors and supplier contacts** with dated roles; retention keys on the role.
31. **IBANs.** Only the SCI's own accounts store an IBAN (encrypted); counterparts keep a fingerprint and last four digits.
32. **Embedding model (D-11) — changed 2026-09-20.** `bge-m3` through Ollama, chosen for French and for its 1024 dimensions, which is the width the `embedding` column was cut for; `AI_EMBED_DIMENSIONS` refuses any other width rather than truncating. Unverified until the box answers one `/api/embed` call. Changing the model width means a migration plus a re-index.
33. **System-level integration exchanges** (no organization) are invisible under RLS and are written and purged from the admin path. Intended, or use a sentinel organization?
34. **"Document missing on an active lease"** is read from `unit_diagnostic.status IN ('missing','expired')`; there is no document flag on the lease itself. Confirm the signal.
35. **Nightly control report** is stored as an `event` of type `control_run` on the organization's first legal entity, report in `event.payload`. Confirm before relying on it.
36. **IRL series storage.** `rule(code='irl_index', domain='rent_indexation')` with one `rule_version.definition` per change, deduplicated by hash. Confirm.

### Raised by the 2026-09-20 build, to decide before real data

42. **Reminder delays (LOY-04).** Coded as defaults, shown on the recouvrement screen: 5 days of grace, first reminder at 8 days, firm reminder at 21, mise en demeure at 45, at least 8 days between two, nothing under 5,00 €, and the ladder suspended when the ledger is more than 7 days stale. The spec says "délais approuvés": approve or change them, and say whether they belong in a `rule` row per SCI rather than a constant.
43. **Mise en demeure by email.** The signature block prints the SCI's name and registered office; the tenant's consent to electronic delivery (`contact_point.consent_electronic_delivery`) is stored but not yet enforced before a formal notice leaves. Confirm you want it enforced, and what a tenant without consent gets (postal letter as a PDF to print).
44. **Short-term rental exports.** The five CSV mapping versions use header names inferred from Airbnb-style exports. A wrong name surfaces as a named missing column, never as a silent mis-import, but one real export from each platform you use is needed to pin them. A mismatched declared total blocks the commit; say whether that strictness is wanted.
45. **Guests as persons.** A booking's guest creates a `person` row and appears in the people directory; the retention class for guests is not decided.
46. **Per-finding justification in an état des lieux.** `object_ref` has no `inspection_finding_id`, so a repair invoice can only be linked to the exit visit, not to one finding. A column would make the deduction traceable per finding; say whether that matters to you before the schema grows.
47. **Heating complement and deposit ceilings.** The heating-period complement date is entered by hand (the heating period start is not held anywhere); the per-kind deposit ceilings (nue, meublée, bail mobilité) are not encoded, only the one- or two-month restitution deadline. Both need a source you validate.
48. **Regularisation adjustment.** Travels as a `rent_term` of kind `charge_regularization` or `credit_note` through the existing `prepare_rent_accounting` command at level C, due 30 days after the statement, with a six-month window for the justificatifs. The accountant confirms the accounts and the wording.
49. **Chart of accounts for the rent invoice.** The connector defaults to 708300 for rent and 706000 for provisions, measured on the local Odoo 18 and matching its labels; the tech pack once said the opposite. The accountant decides, and the values then go into `ODOO_ACCOUNT_*`.

## 4. Infrastructure to measure or decide

37. **Production server — decided 2026-09-20: the owner's dedicated Debian server.** Still to measure there: RAM, CPU flags (`grep -c avx /proc/cpuinfo`), disk, whether a Traefik with the `web` network, `websecure` entrypoint and `letsencrypt` resolver exists (the prod compose assumes it) or must be added, and whether the Ollama box is reachable from it. The prod compose budgets about 1.7 GB across five containers.
38. **Typst on that CPU.** Not documented either way; run the worker image once and render a quittance.
39. **Production database roles — built 2026-09-20 (migration 0006) and wired.** `lfsci_service` (login, no superuser, no BYPASSRLS, member of `lfsci_app`) and `lfsci_maintenance` (login, BYPASSRLS, owner of the pg-boss schema) exist with their grants and a test (tech pack §11.4). `docker-compose.prod.yml` now connects web and worker as those two roles and keeps the owner for the `migrate` service; the db service receives `APP_DB_PASSWORD` and `MAINTENANCE_DB_PASSWORD`. On a database that already exists the passwords are set by hand once (`docs/runbook.md` §2).
40. **Hostname (D-09).** `app.lfsci.fr` assumed; DNS record and Traefik router move together.
41. **Malware scanning (D-07).** Deferred: uploads are sniffed, re-encoded and viewed in isolation; ClamAV needs RAM the box may not have.

## 5. Not built yet, by design or by time

- Durable offline capture queue (IndexedDB) for the PWA; the current queue is in memory and says so.
- RGPD: the technical-log and accounting retention exits are declared as rules but purged by hand; `docs/rgpd.md` §7 lists what is not automated.
- Passkeys: re-checked 2026-09-20 against the installed tree — better-auth 1.7.5 ships no passkey plugin (`node_modules/better-auth/dist/plugins/` has none, and `./plugins/passkey` is not an export), so it needs the separate `@better-auth/passkey` package. Decision for you: add that package, or stay on TOTP only. The TOTP enrolment screen exists at `/parametres/securite` (QR, manual key, backup codes, regeneration, disable) and says in French that passkeys are unavailable.
- ~~Expected-version re-check of the target object before an Odoo send~~ — built: `assertExpectedVersion` re-reads the row's `version` just before the call and refuses with `VERSION_CONFLICT`. It only fires when the command carries an `expectedVersion`: today the web layer sets one for `issue_receipt` alone, so `prepare_rent_accounting`, `record_cca_movement` and `post_supplier_bill` are created without a baseline and the check is a no-op for them. Setting `expectedVersion` on those call sites is a web-side change.
- Server-side sha256 recomputation of uploads (the `document.analyze` job is the place).
- ~~Odoo back-sync maps every `account.move` to the legal entity~~ — built: a move mapped to a rent term, an expense or a current-account movement is applied to that object; what Odoo says is settled on a rent term's move is written as a `payment` plus its `payment_allocation` (LOY-02), and a move whose total no longer matches the term opens an `inbox_item` marked `ambiguous` plus an `odoo_divergence` event instead of overwriting anything (SYN-05). Bank statement lines are read on their own cursor and matched to a `payment` or a `bank_transaction` through `external_ref`; a line that matches nothing is left alone. Still open: which Odoo object the SaaS should read a **bank balance** from (item 14), and whether a statement line with no counterpart should raise an exception rather than be ignored.
- E-signature (V2), Airbnb import screens, tenant portal, IndexedDB queue, Capacitor shell.
- Read models for about thirty secondary tables (inspections, bookings detail, audit log, …) are not exposed by the API yet.

## 6. Unverified vendor details marked in code

Search the code for `to confirm` to find each one: Odoo attachment upload path and `action_post`, `account.bank.statement.line` fields, x2many triples through JSON-2, Resend Receiving API paths, smsmode header and payload, INSEE auth, IGN geocoding path, Gladia region.
