# Questions for the owner

Collected during the autonomous build of 2026-09-20. Each item names what was assumed in the code so the build could continue, and what your answer changes. Answer inline, or reply with the item numbers. Decision ids `D-nn` refer to `docs/tech-pack.md` §14.2.

## 1. Blocking before the first real run

1. **Odoo Online plan (D-01) — decided 2026-09-20.** The owner keeps Odoo Online for its bank reconciliation; self-hosted Community was considered and rejected. The external API is a Custom-plan feature: €37.40 per user per month billed monthly, €29.90 billed yearly on odoo.com/pricing-plan as of 2026-09-20. Remaining action: subscribe to Custom, then create the neutralised duplicate and the bot API key for Phase 0.
1b. **Phase 0 on a local Odoo 18 Community + OCA, run 2026-09-20 (`docs/odoo-poc.md`).** 9 of 10 steps pass through the real connector: tenant, posted rent invoice (`out_invoice`, accounts 708300 and 706000), PDF attachment, CAMT.053 import, full and partial reconciliation via the OCA widget's server methods, lost-response recovery, 137 reads/s. Finding to act on whatever the hosting: **Odoo does not refuse a posting in a locked period, it silently moves the accounting date** past the lock; the SaaS must read the company lock dates and refuse before calling (spec WF-12). Open: which groups the bot user gets (it could not set lock dates, trust a bank account or read `ir.model`), who creates the `x_lfsci_ref` fields on Online (Studio), and whether Ponto at about €10/month beats one manual CAMT download a month. Self-hosting's real cost is the yearly OpenUpgrade of Odoo plus 312 OCA modules, with no 19.0 branch yet for the two reconciliation repositories.
2. **Rent terms have no Odoo entry point yet.** The connector exposes supplier bills (`in_invoice`), attachments and a reconciliation placeholder. The connector now has `createDraftCustomerInvoice` (proven on Odoo 18 Community), but the dispatcher still refuses `prepare_rent_accounting` until the Odoo Online 19 duplicate confirms the same fields and the accounts of your chart; then the mapping is wired.
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
9. **Depreciation policy.** Assets show a straight-line VNC from `commissioned_on` and `duration_years`, land excluded. Default durations and the land/construction split are yours (spec IMM-02 forbids a universal proportion).
10. **Loan insurance.** Computed on the initial principal (`principal × rate ÷ 12`). Some banks compute on the outstanding balance: confirm per loan. Rates are entered as percentages (`1.45` = 1,45 %).
11. **Loan deferral.** `partial` pays interest and insurance with capital intact; `total` capitalises interest. Monthly fees only, no upfront fee line.
12. **CCA movement kinds.** `offset` is treated as a repayment and `correction` as a signed contribution.
13. **Forecast.** Expenses carry no due date; an unsettled expense weighs from today.
14. **Bank balance.** The schema stores movements, not a balance, so "trésorerie" renders `—`. Source to choose: read from Odoo, or a balance column fed by the bank import.
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
32. **Embedding model (D-11).** `mistral-embed`, 1024 dimensions, pinned in the schema.
33. **System-level integration exchanges** (no organization) are invisible under RLS and are written and purged from the admin path. Intended, or use a sentinel organization?
34. **"Document missing on an active lease"** is read from `unit_diagnostic.status IN ('missing','expired')`; there is no document flag on the lease itself. Confirm the signal.
35. **Nightly control report** is stored as an `event` of type `control_run` on the organization's first legal entity, report in `event.payload`. Confirm before relying on it.
36. **IRL series storage.** `rule(code='irl_index', domain='rent_indexation')` with one `rule_version.definition` per change, deduplicated by hash. Confirm.

## 4. Infrastructure to measure or decide

37. **Production server — decided 2026-09-20: the owner's dedicated Debian server.** Still to measure there: RAM, CPU flags (`grep -c avx /proc/cpuinfo`), disk, whether a Traefik with the `web` network, `websecure` entrypoint and `letsencrypt` resolver exists (the prod compose assumes it) or must be added, and whether the Ollama box is reachable from it. The prod compose budgets about 1.7 GB across five containers.
38. **Typst on that CPU.** Not documented either way; run the worker image once and render a quittance.
39. **Production database role.** The compose runs the app as the image superuser, which bypasses RLS; hardening means a non-superuser app role plus a `BYPASSRLS` maintenance role for cross-organization jobs.
40. **Hostname (D-09).** `app.lfsci.fr` assumed; DNS record and Traefik router move together.
41. **Malware scanning (D-07).** Deferred: uploads are sniffed, re-encoded and viewed in isolation; ClamAV needs RAM the box may not have.

## 5. Not built yet, by design or by time

- Durable offline capture queue (IndexedDB) for the PWA; the current queue is in memory and says so.
- Passkeys: better-auth 1.7.5 exposes no passkey plugin without an extra package; TOTP is wired, enrolment UI is not.
- Expected-version re-check of the target object before an Odoo send; needs a per-kind version lookup.
- Server-side sha256 recomputation of uploads (the `document.analyze` job is the place).
- Odoo back-sync maps every `account.move` to the legal entity; the per-object mapping arrives with the rent operation.
- E-signature (V2), Airbnb import screens, tenant portal, IndexedDB queue, Capacitor shell.
- Read models for about thirty secondary tables (inspections, bookings detail, audit log, …) are not exposed by the API yet.

## 6. Unverified vendor details marked in code

Search the code for `to confirm` to find each one: Odoo attachment upload path and `action_post`, `account.bank.statement.line` fields, x2many triples through JSON-2, Resend Receiving API paths, smsmode header and payload, INSEE auth, IGN geocoding path, Gladia region.
