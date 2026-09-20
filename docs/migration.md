# Migration — bringing the owner's data in (MIG-01, MIG-02, MIG-03)

The tooling lives in `scripts/migrate/`. It reads three kinds of sources, writes nothing until it is told to, and produces the two reports the spec asks for: the dry-run inventory (MIG-01) and the opening-balance comparison the owner and the accountant sign (MIG-02). Nothing here has run on the owner's data yet: everything below was proven on the fixtures in `scripts/migrate/fixtures/`, on the fake Odoo server, on the local Odoo 18 and on a migrated test database. The cut-over itself (MIG-03) is a procedure, described at the end.

Every command runs from any directory. Node 24 through fnm, and the `.env` at the repository root supplies the Odoo and database settings.

## 1. What the owner supplies, and in what format

| Source | What | Format | Read by |
|---|---|---|---|
| Odoo (API) | partners, customer invoices, supplier bills, bank statement lines, assets | nothing to export: the tool reads through the API with the bot user's key (`ODOO_*` in `.env`), on the **duplicate** database first (plan P2), never the live one before the cut-over date | `--odoo` |
| Odoo (restored backup) | the same facts read straight from the tables of a backup restored into a scratch PostgreSQL database — the path when no Odoo server can run on the backup (§2.5) | the owner downloads the Odoo Online backup and restores it with `psql` | `--odoo-copy <url>` |
| Spreadsheets | tenants, leases, meters, loans | one CSV per table, first line = column names, `;` or `,` separator, dates `JJ/MM/AAAA`, amounts with a comma (`1 250,00`) | `--tenants`, `--leases`, `--meters`, `--loans` |
| Short-term platform | reservations | the CSV the platform exports, unchanged | `--bookings` |
| Accountant | balances at the cut-over date | one CSV: `Société;Nature;Référence;Solde` | `balances.ts --ledger soldes.csv` |

Columns are recognised by **name**, never by position, and accents, case and spacing do not matter. Each accepted name is listed per mapping version in `scripts/migrate/src/mapping.ts`; the defaults are the French versions (`tenants-fr-v1`, `leases-fr-v1`, `meters-fr-v1`, `loans-fr-v1`, `airbnb-reservations-fr-v1`, `balances-fr-v1`). An English platform export takes `--bookings-mapping airbnb-reservations-en-v1`.

Required columns, per table:

- **tenants**: `Nom`. Optional: `Référence`, `Email`, `Téléphone`, `Id Odoo` (the `res.partner` id, which makes the match certain instead of name-based).
- **leases**: `Société`, `Référence du bail`, `Locataire`, `Début`, `Loyer hors charges`. Optional: `Lot`, `Type de bail` (nu, meublé, mobilité, parking, commercial, professionnel, touristique), `Fin`, `Provision de charges`, `Dépôt de garantie`, `Jour de paiement`.
- **meters**: `Société`, `Immeuble` (the building code as it exists in the application), `Fluide` (électricité, eau froide, eau chaude, gaz, chaleur, photovoltaïque), `Numéro de série`. Optional: `Portée` (individuel, divisionnaire, collectif), `Unité`, `PRM`, `PCE`, `Dernier index` + `Date du relevé` (both or neither).
- **loans**: `Société`, `Référence du prêt`, `Prêteur`, `Capital emprunté`. Optional: `Date de déblocage`, `Durée (mois)`, `Taux nominal`, `Capital restant dû` + `CRD au` (both or neither).
- **balances**: `Société`, `Nature` (locataire, dépôt, emprunt, cca, banque, vnc), `Référence` (the tenant, partner or bank account name; empty for entity-level natures), `Solde`.

Before the first dry run, the application must already hold each legal entity (with its `odoo_company_id` once the Odoo company ids are known) and each building the meters refer to. The importer never creates a legal entity or a building: a row naming an unknown one is rejected with `unknown_entity` or `unknown_building`.

## 2. The commands, in order

Each command is one line to paste. None of them uses `set -e`, `exit` or `${VAR:?}`, so a failure ends the command and not the terminal session.

### 2.1 Dry run (MIG-01)

```bash
eval "$(fnm env)" && fnm use 24 && npx tsx --env-file-if-exists=.env scripts/migrate/dry-run.ts --organization <uuid> --odoo --tenants locataires.csv --leases baux.csv --meters compteurs.csv --loans prets.csv --bookings reservations.csv
```

Reads every source, then the application's existing rows, and writes the plan to `scripts/migrate/out/dry-run.json` (`--out` chooses another path). The terminal shows, as tables: what each source contained and the period it covers, the counts per nature (to import, rejected, deferred), every rejection with its reason, every proposed match with its evidence and confidence, every ambiguity, and the inventory per legal entity with money totals.

Exit codes tell the two failure modes apart:

- `0` — clean: no blocker, the plan can be applied.
- `1` — the plan has blockers: an ambiguity the owner must decide, or a source that read zero records (MIG-02 treats a set of empty totals as a failed extraction, never as "nothing to do").
- `2` — a source could not be read (Odoo unreachable, a file missing, a required column absent, the application database down). Nothing is inventoried; the message names the source. "Nothing found" and "I could not look" never render the same.
- `3` — usage error.

### 2.2 Review

The owner reads the report, fixes the spreadsheets (a rejected line stays out until it is fixed), creates the missing legal entities or buildings in the application, and decides each ambiguity: the report lists the candidates, the importer never picks one. Then the dry run is repeated until it exits `0`. Matches are proposals: they are applied only by the apply step, and only from a plan file the owner has read.

### 2.3 Apply

```bash
eval "$(fnm env)" && fnm use 24 && npx tsx --env-file-if-exists=.env scripts/migrate/apply.ts --plan scripts/migrate/out/dry-run.json --apply
```

Without `--apply` the command only re-renders the plan. With it, the importer:

- refuses a plan that still carries a blocker, and re-checks that every matched existing row still exists (otherwise: "relancez l'import à blanc");
- writes the organisation-level rows (persons, suppliers) in one tenant transaction, then one tenant transaction per legal entity (`withTenant`, so row-level security applies exactly as it does to the application);
- marks every written row as historical: an `event` of type `migration_import` with `origin = 'import'` and `is_migration_import = true`, linked to the row through `object_ref`, carrying the batch id and the source reference; plus the column the table itself offers where one exists (`expense.source_system = 'migration:odoo'` with the Odoo move as `source_external_id`, `meter_reading.origin = 'import'`, `loan_schedule_version.source = 'import'`, `rent_term_version.odoo_move_id`, `payment_allocation.odoo_reconcile_ref`);
- skips any row a previous batch already traced, so running the same plan twice writes nothing twice.

What is written and what is not:

| Read | Written by apply | Why |
|---|---|---|
| persons, suppliers | yes | merged across sources on the Odoo partner id, the email or the name |
| leases | yes, with their initial version, the holder and a deposit account in state `expected` | the deposit's actual receipt is not in the spreadsheet; the balance report shows the gap until the owner records it |
| customer invoices **paid** in Odoo | yes, as `rent_term` in state `settled` with the payment and its allocation confirmed by Odoo | arrears detection ignores a settled term (proven, see §4) |
| customer invoices **unpaid** in Odoo | yes, flagged `is_migration_import` | the paid part becomes a confirmed allocation, the residual stays due; the flag keeps the arrears job and the recouvrement screen silent on it (TMP-04), and the balance report carries the debt |
| supplier bills | yes, as `expense` | `paid` or `posted` from the Odoo payment state |
| loans | yes; the outstanding capital, when dated, becomes a schedule version of source `import` | the official balance stays the ledger's |
| meters | yes, with the last reading of origin `import` | |
| assets | yes, when Odoo answers | `account.asset` is Enterprise-only; the field names are unverified until the Online duplicate answers (§5) |
| bank statement lines | no (deferred, `owned_by_backsync`) | the `odoo.backsync` job mirrors them; a second writer would break the dedup registry |
| platform reservations | no (deferred, `use_in_app_import`) | the application's own Courte durée import maps them and reconstructs payouts |

### 2.4 Opening balances (MIG-02)

```bash
eval "$(fnm env)" && fnm use 24 && npx tsx --env-file-if-exists=.env scripts/migrate/balances.ts --organization <uuid> --as-of 2026-12-31
```

At one date, the application computes tenant balances (terms due minus allocations, per holder), deposits (movements per entity), loans (last known remaining principal, else the principal), partner current accounts (validated movements), bank (opening balance plus mirrored transactions) and net book value, then reads the same figures from the ledger and lists every pair with its difference. Nothing is corrected. Add `--ledger soldes.csv` to compare against the accountant's file instead of Odoo.

Against Odoo, the figures come from posted `account.move.line` rows up to the date, grouped by account family: receivables `411`, deposits `165`, loans `164`, partner accounts `455`, cash accounts (bank, named after the journal owning the account), assets `21` net of depreciation `28`. The prefixes are the defaults the accountant has not confirmed yet (plan P3); each can be overridden (`--account-receivable 411`, `--account-deposit`, `--account-loan`, `--account-cca`, `--account-asset`, `--account-depreciation`). Lines match on Odoo ids first (`legal_entity.odoo_company_id`, `person.odoo_partner_id`, `bank_account.odoo_journal_id`), then on names, and unmatched lines from either side are listed with the full amount as the difference.

Exit `1` when the ledger extraction is empty or all zero; exit `2` when the ledger or the database could not be read.

### 2.5 Reading a restored Odoo Online backup (`--odoo-copy`)

The owner's live base is Odoo 19 **Enterprise**. Its backup restores fine into PostgreSQL, but no Odoo server can boot on it here: the Community image in `docker-compose.dev.yml` lacks the Enterprise modules (`account_asset`, `account_loan`, the Online bank feed), so the API source cannot be pointed at it. The copy source reads the tables directly instead, in one read-only transaction (`BEGIN … READ ONLY`), and never writes to the copy.

**Restoring a backup into a scratch database.** From the Odoo Online database manager, download a backup with the format *pg_dump (without filestore)* — a `dump.sql` inside the zip. Then, one line at a time (each fails on its own without closing the terminal):

```bash
docker exec -i lfsci-dev-db psql -U lfsci -d postgres -c 'CREATE DATABASE lfsci_odoo_online_copy'
docker exec -i lfsci-dev-db psql -U lfsci -d lfsci_odoo_online_copy < dump.sql
```

The dev database is a superuser account, so the extension and ownership statements of the dump pass. The copy is then `postgres://lfsci:lfsci@127.0.0.1:5434/lfsci_odoo_online_copy`; nothing in `.env` points at it, the URL is given on the command line every time. Dropping the copy afterwards: `docker exec -i lfsci-dev-db psql -U lfsci -d postgres -c 'DROP DATABASE lfsci_odoo_online_copy'`. Never restore over `lfsci` or `lfsci_test`.

**Dry run and balances on the copy:**

```bash
eval "$(fnm env)" && fnm use 24 && npx tsx --env-file-if-exists=.env scripts/migrate/dry-run.ts --organization <uuid> --odoo-copy postgres://lfsci:lfsci@127.0.0.1:5434/lfsci_odoo_online_copy --out tmp/dry-run.json
eval "$(fnm env)" && fnm use 24 && npx tsx --env-file-if-exists=.env scripts/migrate/balances.ts --organization <uuid> --as-of 2026-12-31 --odoo-copy postgres://lfsci:lfsci@127.0.0.1:5434/lfsci_odoo_online_copy --out tmp/balances.json
```

`--odoo` and `--odoo-copy` are exclusive; the spreadsheets and the platform export combine with either. Reports carry the owner's real names and amounts: write them under `tmp/` (gitignored), never under `scripts/migrate/out/`. A copy that cannot be reached exits `2` and names it, like any other source.

**What the copy looks like, and what the reader makes of it** (measured on the restored backup, 2026-09-20):

- Odoo 19 stores the account code in `account_account.code_store` as jsonb keyed by company id, and account and journal names as translated jsonb; the reader takes `code_store->>'<company id>'` and `name->>'en_US'`. Exactly one `res_company` is expected; the fiscal-year and hard lock dates are read and printed in the source notes.
- The SCI raises **no invoice**: every fact is a bank statement line reconciled against a revenue or expense account. Rent is recognised on receipt on `706003`, charge provisions on `706004`. A credit there with partner P dated D is a rent received from tenant P; the term's period is **the calendar month of the receipt**, its due date the receipt date, it is `settled` with residual `0.00`, its source reference is `account.move.line:<id>` and it carries the bank statement line id. A month with two receipts from one tenant is **two terms**. A debit on the same account (refund, correction) is netted against the credits of the same partner, month and account in date order — the term keeps the netted line ids in `nettedRefs` — and a debit larger than the month's receipts is rejected `unsupported` for the owner to enter by hand. A receipt with no partner is rejected `missing_field`.
- Persons and suppliers come from `res_partner`, with **roles inferred from the accounts a partner appears on**: `tenant` (706003/706004), `associate` (455100), `lender` (164000/661600), `supplier` (any other expense account, `60`–`63`). A partner can hold several roles; one with none (contacts, the company's own partner) is skipped and counted in the notes. Archived partners with movements are kept: a tenant who left is still a tenant of the history.
- Expenses are the debit lines on expense accounts with a partner (`paid`, residual `0.00`); a credit there (supplier refund) is rejected `unsupported`, a partner-less one `missing_field`. Depreciation charges (`68xxxx`) are not expenses and are skipped; loan interest (`661600`) becomes a loan movement.
- Deposits (`165500`), partners' current accounts (`455100`) and the loan (`164000` + `661600`) come out as `deposit_movement`, `cca_movement` and `loan_movement` records with a direction (`received`/`returned`, `contribution`/`repayment`, `drawdown`/`repayment`/`interest`). They are read and inventoried, then **deferred** (`entered_in_app`): the owner records them in the application and the balance report reconciles them. The deposit's tenant is the partner on the line, nothing else identifies it. The loan itself is derived from the `164000` credit (principal, release date, lender, outstanding after the last repayment); duration and rate are unknown and stay empty.
- Assets come from `account_asset` (states `open`, `close`, `paused`; models and cancelled rows excluded), bank lines from `account_bank_statement_line` joined to their posted move for the date. Suspense (`512002`) lines are counted in the notes with their balance: a non-zero balance is unreconciled residue to letter in Odoo before the cut-over.
- **A tenant with rents but no lease** anywhere (application or spreadsheet) gets a **proposed lease** in the plan (`BAIL-ODOO-<partner id>`, kind `other`, start = first month received, rent and charges = the monthly total seen most often, deposit = deposits received minus returned, no end date, no unit, no payment day). The plan lists it under "Baux proposés" and the apply creates it; the owner completes it afterwards. A tenant whose name is ambiguous is reported, never resolved by picking one.

What the copy cannot tell: the contractual rent (only what was received), the lease start and end (only the first and last receipts), the period a receipt pays for (assumed to be its month — a late payment lands in the wrong month), which lease a deposit belongs to when a tenant has several, the loan's rate and duration, and anything about units or buildings.

**The balance report** reads the copy's `account_move_line` sums per account family (`411`, `165`, `164`, `455`, cash accounts by bank journal, `21` net of `28`), exactly as the API ledger does. No `411` receivable is used by this SCI, so the ledger side has no tenant lines: a tenant balance in the application that is not `0.00` is a difference to explain.

## 3. What a clean dry run looks like

Run on the fixtures against the fake ledger, abridged. The terminal is in French because the owner reads it.

```
Sources
| source                                                  | lus | mappés | rejetés | période                 |
| Odoo https://odoo.test (lfsci-test)                     | 11  | 8      | 2       | 2026-06-12 → 2026-09-01 |
| Tableaux tenants.csv, leases.csv, meters.csv, loans.csv | 17  | 12     | 5       | 2019-06-15 → 2026-06-30 |
  · partenaires : 4 lus, 1 sans rang client ni fournisseur ignorés (contacts, société, utilisateurs)
  · immobilisations : account.asset non lisible sur cette base (...) — la VNC viendra de l’export de l’expert-comptable

Par nature (personnes et fournisseurs : distincts, hors correspondances avec l’existant)
| nature           | à importer | rejetés | différés |
| personnes        | 2          | 0       | 0        |
| fournisseurs     | 1          | 0       | 0        |
| termes de loyer  | 1          | 2       | 1        |
| dépenses         | 1          | 1       | 0        |
| lignes bancaires | 0          | 0       | 1        |
| baux             | 2          | 5       | 0        |
| compteurs        | 2          | 2       | 0        |
| prêts            | 2          | 1       | 0        |

Rejets
| source      | nature    | référence       | motif            | détail                                                                        |
| odoo        | rent_term | account.move:60 | not_posted       | account.move:60 est draft, seules les pièces comptabilisées sont reprises     |
| odoo        | expense   | account.move:71 | missing_field    | BILL/2026/00004 n’a pas de partenaire                                         |
| spreadsheet | lease     | leases.csv:4    | invalid_date     | Début illisible : « 31/02/2025 »                                              |
| spreadsheet | lease     | BAIL-2025-004   | unknown_entity   | Société « SCI Inconnue » absente de l’application : créez-la avant l’import   |
| odoo        | rent_term | account.move:61 | unknown_lease    | Aucun bail pour Jean Dupont dans SCI Exemple : ajoutez-le au tableau des baux |
| spreadsheet | meter     | GAZ-0001        | unknown_building | Immeuble « IMM-99 » absent de SCI Exemple                                     |

Correspondances proposées (jamais appliquées par l’import à blanc)
| nature       | lu            | existant      | preuve          | confiance |
| legal_entity | SCI Exemple   | SCI Exemple   | odoo_company_id | high      |
| person       | Élodie Durand | élodie DURAND | name            | medium    |
| building     | IMM-01        | IMM-01        | code            | high      |

Ambiguïtés à trancher par le propriétaire
  aucune

Différés (lus, non écrits par l’import)
| owned_by_backsync         | 1 |

Inventaire par société (différés compris, rejets exclus)
| société     | termes de loyer | dépenses   | baux        | compteurs | prêts         |
| SCI Exemple | 2 (1560.00)     | 1 (312.50) | 2 (1250.00) | 2         | 2 (275000.00) |

Aucun bloqueur : le plan peut être appliqué avec --apply.
```

A dry run is clean when it exits `0`, the rejections are all ones the owner accepts leaving out, and the deferred rows are only of the three expected reasons. A run whose Odoo source reads zero partners or zero invoices is not clean whatever the exit code says about the spreadsheets: the source table shows it and the blocker names it.

## 4. What the tests prove

`scripts/migrate/tests/`, run by `npm run check` (unit project). The database test runs when `TEST_DATABASE_URL` is set and uses its own database (`<name>_migrate`) so the other suites' truncations do not race it.

- `spreadsheet.test.ts` — every rejection reason on the fixtures (`missing_field`, `invalid_date` including a 31 February, `invalid_money`, `invalid_value`, `duplicate_reference`), and that a missing file or a missing required column is "could not look", not "empty".
- `matching.test.ts` — `MARTIN Camille` matches `Camille Martin` and `Élodie DURAND-Léger` matches `elodie durand leger`; the Odoo id and the email win over the name; two homonyms are reported as an ambiguity with both candidates, never resolved by taking the first; one person read from two sources is merged, two Odoo partners under one name are not.
- `odoo-source.test.ts` — the reader goes through the connector only (`search_read`), classifies partners by rank, maps invoices to terms and bills to expenses, rejects a draft and a partner-less bill, notes an absent `account.asset` the way the local Odoo 18 answers it, and turns an unreachable server into `SourceUnreachable`.
- `plan.test.ts` — the Odoo invoice lands on the spreadsheet lease through the tenant; the unpaid one is deferred; unknown entity, person, lease and building are rejected with the row named; an existing person spelled differently is proposed, not applied; two existing leases for one tenant block the plan as an ambiguity; a source with zero records blocks it too; a dead source or a dead database fails the run and says which.
- `balances.test.ts` — the accountant's file and the Odoo move lines both produce the same report shape; liabilities are read as what is owed; a cash line posted from a miscellaneous journal still counts on the bank account; an empty ledger is a blocker; an absent file is unreachable.
- `odoo-copy.test.ts` — on synthetic lines: the 706003 credit-minus-debit netting per partner and month (a debit spread over two receipts, one it cannot absorb), two receipts in a month giving two terms with their statement line ids, role inference from the accounts (several roles at once, none for a depreciation or bank line), the movement kinds and the derived loan, and an unreachable copy as `SourceUnreachable`. With `TEST_DATABASE_URL`, it creates `lfsci_test_odoo_copy` on the dev server, seeds a handful of Odoo 19-shaped tables (jsonb `code_store` and names, a draft move, an asset model), runs the copy reader, the plan (proposed lease with deposit, every term on it) and the copy ledger at two dates, then drops the database.
- `exit-code.test.ts` — the real entry point, spawned with an unreachable Odoo and an unreachable database, exits `2`, names both, and prints no inventory; the same with an unreachable `--odoo-copy`; `--odoo-copy` without a URL is a usage error.
- `historical-flag.test.ts` (database) — the apply writes the settled history through `withTenant`, every row carries its `migration_import` event; then `arrearsDetect` runs on a date where every imported term is overdue and writes no deadline, opens no exception and sends nothing. The second test writes the deferred unpaid term by hand and shows the deadline appear, which is why it is deferred. The third applies the same plan twice and counts nothing written the second time.

## 5. Known limits before the owner's data

- **Unpaid history is flagged, not deferred.** `rent_term.is_migration_import` (migration 0009) marks every imported term, and the shared overdue query in `packages/db/src/arrears.ts` excludes flagged terms, so an inherited debt never opens an arrear, a deadline or a reminder. It still counts in the tenant balances of the opening report, which is where the accountant reconciles it. A term the app produces after the cut-over is not flagged and is detected as usual.
- **Assets.** `account.asset` does not exist on Odoo Community, so the field names the reader asks for (`original_value`, `book_value`, `acquisition_date`) are unverified until the Online duplicate answers; the reader reports the model as unreadable instead of failing, and the net book value comes from the accountant's file in the meantime.
- **Loans are not in Odoo as objects**, only as `164` balances: the loan rows come from the owner's spreadsheet, the balance report compares the entity total.
- **The received date of a settled term is assumed** to be its due date, since `account.move` does not carry the payment date; the event payload says so (`receivedOnAssumed`).
- **Odoo partners without a customer or supplier rank are skipped** by the API source (contacts, the company, system users): a tenant never invoiced through Odoo comes from the tenants spreadsheet. The copy source infers roles from the accounts instead (§2.5).
- **On the owner's copy the dry run needs the legal entity first.** The company must exist in the application with `odoo_company_id` set to the copy's `res_company.id`; otherwise every record is rejected `unknown_entity` and the plan is blocked ("aucune société de cette source n'existe dans l'application"), which is exit `1`, never a silent `0`.

## 6. Cut-over (MIG-03)

Done with the accountant, not alone. The reversible part is everything up to step 6; step 7 is the point of no return.

1. **Fix the date** with the accountant: the last day the old rent generator runs, and the date of the opening balances (usually the same month end).
2. **Pilot on the duplicate.** Point `.env` at the neutralised duplicate (P2), run the dry run, the apply and the balance report there, on a representative subset if the volume is large. Fix the spreadsheets until the dry run is clean. Keep the plan file and the balance report: they are the pilot's evidence.
3. **Backups.** Take a database backup (`docs/runbook.md` §3) and keep the plan file: the batch id in every `migration_import` event is what identifies the rows of one import, and an import is never undone by deleting official rows.
4. **Stop the old generator** on the fixed date, then finish or list the operations in flight (rents issued but not yet paid, deposits not yet received, bills received but not yet posted). Those in flight are the unpaid rows the importer defers: they are carried by hand or by the first monthly cycle.
5. **Dry run on the live read**, same command, `.env` on the live database's bot key: the plan must be clean and the counts must match the pilot's. A drop in counts is a failed extraction, not fewer records.
6. **Balance report at the fixed date**, against Odoo and against the accountant's file. Every difference is explained in writing or corrected at its source (the spreadsheet, the ledger), then the report is regenerated. The owner and the accountant sign the last one.
7. **Apply** with `--apply`. From here the application holds the history and the old generator must not be restarted: a second run of either would double the receivables. This is the point of no return.
8. **Check for a double bank feed**: exactly one feed per bank account (`bank_account.feed_source`), and the first `odoo.backsync` run after the apply creates no duplicate transaction (the dedup registry `bank_transaction.source_fingerprint` is the guard).
9. **Watch one full monthly cycle** (WF-02): the rent terms of the first month are generated by the application, posted to Odoo, reconciled from the bank feed, and the Recouvrement screen shows only what is genuinely due. Non-blocking anomalies stay assigned and visible in Validations and Inbox; they do not stop the cycle.
10. **Sign the deviation report**: the balance report regenerated at the end of the first cycle, with the differences of step 6 closed or explained.
