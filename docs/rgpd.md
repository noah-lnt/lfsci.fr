# Personal data — register, retention and rights

Spec RGPD-01 to RGPD-05. Written 2026-09-20 against the schema of `packages/db/migrations` and the
`retention.purge` job. Everything here is a **proposal until the owner validates it** (RGPD-02
requires the matrix to be validated before production); the code applies it, it does not decide it.
The register is filed in French: translate this table, do not paraphrase it.

## 1. Who is who

The SCI determines the rental processing and is therefore the controller. The SaaS and its
sub-processors (hosting, object storage, transcription, OCR, e-mail) are processors, each under its
own contract. Consent is not the basis of the rental file: the lease performs a contract, the
accounting pieces answer a legal obligation, and the security logs rest on a legitimate interest.

## 2. Register of processing

| # | Purpose | Legal basis | Data subjects | Categories | Recipients | Where it lives |
|---|---|---|---|---|---|---|
| T1 | Selecting a tenant | Pre-contractual measures | Applicants, guarantors | Identity, income, employment, supporting files | Owner | `person`, `person_role(applicant)`, `document(retention_class='application_3m')` |
| T2 | Running the lease | Contract | Tenants, co-tenants, occupants, guarantors | Identity, contact, lease, rent account, deposit, inspections | Owner, accountant, Odoo | `lease*`, `rent_term*`, `payment*`, `deposit_*`, `inspection*` |
| T3 | Keeping the books | Legal obligation | Tenants, suppliers, partners | Invoices, entries, bank lines, supporting files | Accountant, Odoo, tax authority on request | `expense*`, `bank_transaction`, `document(retention_class='accounting_10y')`, Odoo |
| T4 | Maintenance and works | Contract, legitimate interest | Tenants, suppliers | Interventions, quotes, photos, meters | Owner, suppliers | `intervention`, `works_project`, `equipment`, `meter*` |
| T5 | Insurance and claims | Contract, legal obligation | Tenants, third parties | Policies, certificates, claims, indemnities | Insurer | `insurance_policy`, `claim*` |
| T6 | Communicating with tenants | Contract | Tenants, applicants | E-mails, notes, attachments | Resend (sending), owner | `activity`, `message_outbound`, `inbox_item` |
| T7 | Document understanding (OCR, transcription, assistant) | Legitimate interest | Everyone named in a document | Document text, embeddings, extracted fields | Local Ollama instance on the owner's hardware; Mistral OCR and Gladia only when their keys are set | `document_version(role='ocr_text'…)`, `ai_extraction`, `embedding`, `search_document` |
| T8 | Security, audit and operations | Legal obligation, legitimate interest | Users | Sessions, audit trail, correlation ids, raw integration exchanges | Owner | `audit_log`, `integration_exchange`, `auth_session` |

RGPD-04: the AI and OCR processors are named per environment by `AI_PROVIDER`, `MISTRAL_API_KEY`
and `GLADIA_API_KEY`. The default deployment keeps inference on the owner's GPU box, so T7 has no
transfer; enabling a vendor key adds a processor to this register and needs its contract, its
processing location and a "no training on our data" clause first. European hosting alone is not
proof of the absence of a transfer.

## 3. Retention matrix

Seeded as `rule` rows (`domain = 'retention'`, one `rule_version.definition` each) by
`packages/db/src/seed.ts`; `RETENTION_MATRIX` there is the single source and the job reads it per
organization. `activeDays` is the active-base window, `action` is what leaving it means.

| Data class | Active base | Action at the end | Enforced by |
|---|---|---|---|
| `application_file` — unsuccessful application and solvency files | 90 days | delete | `retention.purge`, through `document.retention_until` |
| `voice_audio` — raw audio of a transcribed voice note | 7 days after the transcript | delete the audio, keep the text | `retention.purge` |
| `integration_exchange` — raw webhook and connector bodies | 30 days | delete | `purge_integration_exchange()` from the maintenance role |
| `technical_log` — technical logs and security audit | 365 days | aggregate or anonymise | manual, to be automated |
| `lease_file` — lease, tenant account, guarantee | 5 years after closure | pseudonymise | `pseudonymizePerson`, on request or on review |
| `accounting` — invoices, entries, supporting files | 10 years from the close | intermediate archive, then purge | manual, with the accountant |
| `inspection_media` — inspection, claim and dispute photos | 5 years, frozen while a dispute runs | review | `legal_hold` on the document |
| `backup` — database backups | 35 days rolling | automatic expiry | `docker/backup` |

Two mechanisms carry the whole matrix on the document side: `document.retention_until`, the exit
date of the class the document was filed under, and `document.legal_hold`, which freezes it whatever
the date says. A document with no `retention_until` is never purged automatically — an unclassified
document is a classification bug, not an implicit forever.

## 4. The purge job

`retention.purge` (`apps/worker/src/jobs/retentionPurge.ts`), scheduled at 03:15 Europe/Paris, one
pass per active organization:

1. **Transcribed audio.** An `original` version with an `audio/*` content type whose document also
   holds a `transcript` older than the window loses its object in storage and its row; the
   transcript and the document survive, and the document's `current_version_id` moves to the
   remaining version.
2. **Expired documents.** `retention_until < today` and no legal hold: every version's object is
   deleted from storage, the version rows go, the `search_document` and `embedding` rows built from
   the document go with them (RGPD-03), and the document row stays with `status = 'purged'` so the
   lease, the receipt or the audit entry that names it still resolves.
3. **Integration exchanges.** `purge_integration_exchange(days)` on the admin connection, because
   the system-level rows carry no `organization_id` and RLS hides them from every tenant session.

Each step writes an `audit_log` entry (`retention.audio_purged`, `retention.document_purged`). The
job never deletes a `person`, a `lease` or an accounting row: erasure there is a pseudonymisation.

Boundaries proved by `apps/worker/tests/jobs/retentionPurge.test.ts`: the day of `retention_until`
keeps the document and the day after purges it; a legal hold survives any date; audio that was never
transcribed is kept; the window comes from the organization's own rule when it has one.

## 5. Serving a request

Identity is verified proportionately first — for a tenant, the lease and an e-mail address already
in `contact_point`; never a copy of an identity card by default.

**Access or portability (RGPD-01).** Enqueue `retention.purge` with
`{ mode: "export", organizationId, personId }`. `exportPerson` returns the `person` row, contact
points, dated roles, lease parties, authored activities, authored documents and the AI extractions
made from them, with the export instant. Hand it over as JSON plus the documents themselves; note
the request and the answer date.

**Rectification.** Correct the source row through the application. Anything derived from it — OCR
text, index, embeddings, thumbnails — is rebuilt from the source, never edited in place.

**Erasure (RGPD-01/03).** Enqueue `{ mode: "pseudonymize", organizationId, personId }`.
`pseudonymizePerson` refuses when `person.retention_hold` is set, which is how a piece still legally
required is protected, and the refusal is the answer to give with its reason. Otherwise it blanks
the identifying fields, marks the row `pseudonymized`, revokes the contact points, deletes the
derived versions of the person's documents (`ocr_text`, `transcript`, `thumbnail`, `summary`) with
their stored objects, and drops the index and embedding rows of the person and of those documents.
The business history survives on purpose: leases, receipts and the audit chain depend on the row.

**Limitation and objection.** Set `person.retention_hold` (limitation) or close the dated role
(objection); neither is a deletion.

**What an erasure does not reach.** Backups are immutable for their 35 days and expire on their own;
a restore replays the pseudonymisations recorded since the dump **before** the stack is reopened
(BCP-03). Anything already posted in Odoo follows Odoo's own retention and the accounting
obligation, and is listed in the answer rather than silently omitted.

## 6. Breach procedure (RGPD-05)

1. **Detect.** `/admin/ops`, the nightly control report, GlitchTip and the queue's dead letters.
2. **Contain.** Rotate the exposed secret, revoke the sessions, stop the affected job. The
   correlation id is what scopes the investigation.
3. **Preserve.** `audit_log` and `integration_exchange` are the evidence: neither is purged while a
   breach is open, which means suspending `retention.purge` before it runs.
4. **Qualify.** The owner is the designated responsible and decides; the assistant never concludes
   on its own that there is no risk.
5. **Notify.** CNIL within 72 hours of becoming aware when a risk exists, and the data subjects
   without undue delay when the risk is high.
6. **Record.** Every breach in the incident register, notified or not, with the reasoning.

The procedure and the contacts are tested before opening the service; an untested procedure counts
as absent.

## 7. What is not automated yet

- The technical-log and accounting exits are manual; only their rules are seeded.
- `lease_file` pseudonymisation at the five-year mark is a review, not a scheduled job: it needs the
  closure date of the tenant account, which the accountant validates.
- Applications are purged through `document.retention_until`; nothing sets that date at capture
  time yet, so it is filled by hand until the application screen exists (PLAN slice 2).
