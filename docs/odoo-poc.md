# Phase 0 — Odoo 18 Community + OCA, measured

Run on 2026-09-20 against a local instance, through the real `@lfsci/odoo` connector.
Raw payloads (redacted) land in `scripts/odoo-poc/out/` — gitignored.

## Environment

| Item | Value |
|---|---|
| Image | `odoo:18` — `Odoo Server 18.0-20260908`, digest `sha256:478065867b94` |
| Database | `postgres:16`, one container, `lfsci_odoo`, French chart (`l10n_fr` 18.0.2.1 + `l10n_fr_account` 18.0.2.2) |
| Memory | odoo 128 MiB / 1 GiB, postgres 102 MiB / 256 MiB (`docker stats --no-stream`, idle after the probe) |
| OCA | `bank-statement-import` 01be32e, `account-reconcile` 8a24fc4, `account-financial-reporting` 95c63a6, + 7 dependency repos, 312 modules linked, 158 MB on disk |
| Installed | `account_statement_import_camt` 18.0.1.0.1, `_ofx` 18.0.1.0.0, `_sheet_file` 18.0.1.1.2, `account_reconcile_oca` 18.0.1.1.14, `account_reconcile_model_oca` 18.0.1.1.3, `account_financial_report` 18.0.1.4.26 |
| Transport | `/jsonrpc` + `object.execute_kw`, API key as the password, `common.authenticate` for the uid |
| Deps added | none — no `npm install` was needed |

## Steps

| # | Step | Result | ms | Evidence |
|---|---|---|---|---|
| a | authenticate + capability snapshot | PASS | 300 | 10 models via `fields_get`; `x_lfsci_ref` present on `res.partner`, `account.move`, `account.bank.statement.line`, `ir.attachment` |
| b | tenant partner | PASS | 7 | `res.partner.create`, found back by `ref` |
| c | rent invoice 700 + 80, posted | PASS | 88 | `INV/2026/00021`, 780.00 EUR, accounts `708300` (Locations diverses) and `706000` (Prestations de services), no VAT |
| d | PDF attached to the move | PASS | 9 | `ir.attachment.create` with base64 `datas`, `res_model`/`res_id` |
| e | CAMT.053 with 2 transactions | PASS | 81 | `account.statement.import` → 780 credit + 45.60 debit, journal matched on the IBAN |
| f | reconcile 780 against the invoice | PASS | 104 | `add_multiple_lines` then `reconcile_bank_line` → `payment_state=paid` |
| g | partial: 900 invoiced, 500 received | PASS | 228 | same two calls → `payment_state=partial`, residual 400 |
| h | lost response, resolved by reference | PASS | 2198 | write timed out → `RESULT_UNKNOWN`, `findByOperationRef` → `one` |
| i | closed period | **UNKNOWN** | 313 | **no refusal**: lock 2026-08-20, entry asked for 2026-08-15, Odoo posted it at 2026-08-31 |
| j | sustained reads | PASS | 728 | 100 serial `search_read` in 0.73 s → **137 calls/s** |

## API surface confirmed

- **Discovery**: `/doc` does not exist before Odoo 19 (404 measured), and `ir.model` is readable only by
  Access Rights users — a service account gets `AccessError`. The snapshot is therefore built from
  `<model>.fields_get` per model; it proves models and fields, never methods (no RPC lists methods).
- **`execute_kw` is positional where the ORM signature is**: `create` takes `vals_list` as `args[0]`
  (`IndexError` as a keyword), `write` takes `[ids, vals]` (`TypeError` on `vals=`), `read` takes ids
  positionally with `fields` as a keyword, `search_read` is entirely keywords. `shapeExecuteKw` encodes this.
- **x2many command triples** `[0, 0, vals]` on `invoice_line_ids` and `line_ids`: accepted.
- **`action_post`**: `ids` positional, works for the bot user.
- **`ir.attachment.create` with base64 `datas`**: confirmed (`redactValue` already blanks `datas`).
- **Statement import wizard**: `account.statement.import` (transient), fields `statement_file` (base64) +
  `statement_filename`, method `import_file_button()`; the journal is found from the CAMT IBAN, or from
  `context.journal_id` when the format carries no account number.
- **Reconciliation**: `account.bank.statement.line.add_multiple_lines(domain)` then `reconcile_bank_line()`.
  `unreconcile_bank_line()` and `clean_reconcile()` exist; redoing a match after an unreconcile left the
  entry unbalanced in one attempt, so **treat unreconcile-then-redo as unsupported over RPC for now**.
- **Errors**: JSON-RPC answers **HTTP 200 with an `error` envelope** — `error.data.{name,message,arguments,debug}`.
  A wrong key is `odoo.exceptions.AccessDenied`; a stale session is `odoo.http.SessionExpiredException`.
- **API keys**: Odoo 18 requires an expiration date unless the key is generated in `sudo`/by a system user;
  a bot generating its own key through the UI is capped by its groups' `api_key_duration`.
- **`is_reconciled` is not a verdict.** It is a stored computed field; after an RPC reconciliation it has read
  `false` on a fully paid invoice. Trust `account.move.payment_state` and `amount_residual`.

## What OCA gives, and what the SaaS still owes

OCA gives the import (CAMT.053/054, OFX, CSV/XLSX), the statement objects, a reconciliation widget with a
server API, and reconcile models. `account_statement_import_file_reconcile_oca` installs itself and
**auto-matches at import**: with the tenant name, IBAN and the invoice number in the remittance, the 780 line
was reconciled and the invoice marked paid with no API call from us (measured, then neutralised so step (f)
could exercise the API). Strip those hints and it stays open — which is exactly the population the SaaS is for.

The SaaS still owes: the rent ledger and what is *expected*; the decision on every ambiguous line (partial,
grouped, unknown payer); the operation reference and the idempotence around it; the approval and audit trail;
the exception queue; and the accounting-date policy below, because Odoo will not enforce it.

## Verdict

**Community + OCA is functionally sufficient for this owner, and the accounting-date behaviour is the reason
to think twice — not the module set.** Every step the design depends on worked, at 137 reads/s locally on
128 MiB of RAM, which is two orders of magnitude above the 1 req/s the connector budgets.

The one hard finding is step (i): **Odoo 18 does not refuse a posting in a closed period, it silently moves the
accounting date forward** (2026-08-15 → 2026-08-31 with the lock at 2026-08-20). The `hard_lock_date` added in 18
behaves the same, and it **cannot be removed once set**. Spec WF-12 says the SaaS never shifts a date to get past
a lock; Odoo does it for us. The SaaS must therefore read the company lock dates, refuse before calling, and
reconcile `date` against `invoice_date` after every post. `PERIOD_LOCKED` stays mapped — the wording is covered by
a unit test — but it will rarely fire on 18.

Bank feed, in order of cost: manual CAMT/OFX download from the bank (zero cost, one upload a month, proven here);
`account_statement_import_online_ponto` (Ponto, ~€10/month, OCA-maintained, not tested); an aggregator called by
the SaaS, which pushes CAMT into the same wizard and keeps the bank contract out of Odoo entirely.

Operational cost of self-hosting: ~1.3 GiB of RAM for the pair, a nightly `pg_dump` plus the filestore,
and a yearly major upgrade that Community does **not** automate — OpenUpgrade plus 312 OCA modules that must
all have published their next branch first (there is no 19.0 for `bank-statement-import` or `account-reconcile`
today). That upgrade, not the licence, is the real bill.

## Differences from the JSON-2 design (keep the connector right for Odoo Online 19)

1. JSON-2 is one HTTP call with a bearer and everything in keywords; JSON-RPC needs a prior `authenticate`,
   carries the key in the body, and splits positional from keyword arguments. Both live behind `config.transport`.
2. JSON-2 signals failure with the HTTP status; JSON-RPC always answers 200. `mapRpcFault` maps the envelope
   onto the same `AppError` codes, and only HTTP-level 5xx/429 stay transport failures worth a retry.
3. `/doc` gives methods; `fields_get` does not. On 19 the snapshot should go back to `/doc` — `fetchCapabilitySnapshot`
   already switches on the transport — otherwise `assertCapability` only ever checks the model and its fields.
4. The API key must never reach an exchange record: it sits at `params.args[2]`, which `redactValue` cannot see
   by key name, so the client blanks it before recording.

## Open questions

- Does Odoo Online 19 still shift the accounting date past a lock, or does JSON-2 surface a refusal?
- Custom fields (`x_lfsci_ref`) needed an Access-Rights user to create; on Odoo Online this is Studio. Who creates them?
- The bot could not set a lock date, trust the company bank account, or read `ir.model` — the group set for the
  service account needs the owner's sign-off (today: Invoicing Administrator + Contact Creation).
- Setting a lock date is refused while unreconciled statement lines or draft entries remain in the period.
  That makes month-end closing a workflow the SaaS must drive, not a flag it can set.
- Is Ponto worth €10/month against a monthly manual CAMT download, given the owner's volume?
