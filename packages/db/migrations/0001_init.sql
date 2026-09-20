-- lfsci.fr — physical data model. Target PostgreSQL 18 with pgvector; the syntax stays PostgreSQL 17-compatible.
--
-- Multi-tenancy: the API opens a transaction per request and runs
--   SET LOCAL app.organization_id = '<uuid of the session organization>';
-- before any statement. SET LOCAL dies with the transaction, so a pooled
-- connection cannot leak the setting to the next request. The organization is
-- taken from the authenticated session, never from a payload (ARC-02). The
-- application role must NOT own these tables and must not be BYPASSRLS;
-- FORCE ROW LEVEL SECURITY is applied so even the owner is filtered.
-- Background workers set the same variable from the job row before processing.
--
-- Authority (§4): columns holding Odoo-owned values (official numbers, posted
-- amounts, official balances, VNC) are stored as a dated read-only copy;
-- `*_read_at` marks the freshness and nothing in the SaaS may overwrite the
-- source. Values the SaaS owns carry no such column.
--
-- Money is numeric(14,2) + currency char(3). Rates, shares and index keys are
-- numeric(9,6) so a percentage is never the rounded display value (F06).
-- Contract dates are `date` (local civil dates), technical instants timestamptz.
--
-- Cross-organization integrity: every table that can be pointed at by the
-- object_ref registry carries UNIQUE (organization_id, id) so the registry can
-- use composite foreign keys. A row therefore cannot reference an object of
-- another organization even if an id is guessed (MOD-01, SEC-01).
--
-- No ON DELETE CASCADE anywhere the audit, the timeline or a financial trace
-- depends on the row: functional deletion is a status or a pseudonymization,
-- never a physical cascade (MOD-01, RGPD-01/03, SEC-03).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- 1. Organization, users, roles
-- ---------------------------------------------------------------------------

CREATE TABLE organization (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  default_currency char(3) NOT NULL DEFAULT 'EUR',
  display_timezone text NOT NULL DEFAULT 'Europe/Paris',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz,
  version     integer NOT NULL DEFAULT 1
);

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','disabled')),
  mfa_enrolled_at timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz,
  version       integer NOT NULL DEFAULT 1
);
-- app_user is intentionally NOT tenant-scoped: one physical person may hold a
-- membership in several organizations. All authorization goes through membership.

CREATE TABLE membership (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  app_user_id     uuid NOT NULL REFERENCES app_user(id),
  role            text NOT NULL CHECK (role IN ('owner_admin','delegated_manager','accountant','partner_reader','tenant_portal','provider','technical')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','revoked')),
  scope_note      text,
  starts_on       date,
  ends_on         date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, app_user_id, role)
);

-- ---------------------------------------------------------------------------
-- 2. Legal entities and bank accounts
-- ---------------------------------------------------------------------------

CREATE TABLE legal_entity (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization(id),
  name                    text NOT NULL,
  legal_form              text NOT NULL DEFAULT 'sci' CHECK (legal_form IN ('sci','sarl','sas','sci_familiale','individual','other')),
  siren                   text,
  income_tax_regime       text NOT NULL DEFAULT 'to_qualify' CHECK (income_tax_regime IN ('is','ir','to_qualify')),
  vat_status              text NOT NULL DEFAULT 'to_qualify' CHECK (vat_status IN ('not_subject','exempt','franchise','vat_non_deductible','subject','to_qualify')),
  -- §1: "non assujettie à la TVA" is an owner hypothesis; nothing may be
  -- automated while these validation dates are null.
  fiscal_qualification_validated_on date,
  fiscal_qualification_validated_by uuid REFERENCES app_user(id),
  e_invoicing_channel     text CHECK (e_invoicing_channel IN ('none','pdp','pa','to_qualify')),
  fiscal_year_end_month   smallint CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
  fiscal_year_end_day     smallint CHECK (fiscal_year_end_day BETWEEN 1 AND 31),
  odoo_company_id         integer,
  currency                char(3) NOT NULL DEFAULT 'EUR',
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','dissolved','archived')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz,
  version                 integer NOT NULL DEFAULT 1,
  CONSTRAINT legal_entity_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE bank_account (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization(id),
  legal_entity_id       uuid NOT NULL REFERENCES legal_entity(id),
  label                 text NOT NULL,
  bank_name             text,
  iban_last4            text,
  iban_fingerprint      text,
  bic                   text,
  purpose               text NOT NULL DEFAULT 'operating' CHECK (purpose IN ('operating','deposit','transit','savings','loan')),
  currency              char(3) NOT NULL DEFAULT 'EUR',
  opening_balance       numeric(14,2) NOT NULL DEFAULT 0,
  opening_balance_on    date,
  odoo_journal_id       integer,
  feed_source           text CHECK (feed_source IN ('odoo_bank_sync','odoo_manual_import','fallback_import')),
  -- AUT-02: exactly one live feed per account; a fallback import shares the
  -- same dedup registry (bank_transaction.source_fingerprint) and never
  -- creates a second stream.
  feed_last_success_at  timestamptz,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','disconnected')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz,
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT bank_account_org_id_key UNIQUE (organization_id, id)
);

-- Dated read-only mirror of the Odoo bank statement lines (§4: Odoo owns the
-- line, the reconciliation and the lettering).
CREATE TABLE bank_transaction (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  bank_account_id     uuid NOT NULL REFERENCES bank_account(id),
  booked_on           date NOT NULL,
  value_on            date,
  amount              numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  label               text,
  counterparty_name   text,
  source_fingerprint  text NOT NULL,
  odoo_statement_line_id integer,
  reconciliation_status text NOT NULL DEFAULT 'unreconciled'
    CHECK (reconciliation_status IN ('unreconciled','partially_reconciled','reconciled','excluded')),
  read_at             timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, bank_account_id, source_fingerprint)
);

CREATE INDEX bank_transaction_account_booked_idx
  ON bank_transaction (bank_account_id, booked_on DESC);

-- ---------------------------------------------------------------------------
-- 3. Buildings, units, usage history
-- ---------------------------------------------------------------------------

CREATE TABLE building (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  legal_entity_id   uuid NOT NULL REFERENCES legal_entity(id),
  code              text NOT NULL,
  name              text NOT NULL,
  address_line1     text NOT NULL,
  address_line2     text,
  postal_code       text,
  city              text,
  country_code      char(2) NOT NULL DEFAULT 'FR',
  cadastral_ref     text,
  acquired_on       date,
  sold_on           date,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','sold','archived')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, code),
  CONSTRAINT building_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE unit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  building_id       uuid NOT NULL REFERENCES building(id),
  code              text NOT NULL,
  label             text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('dwelling','annex','parking','storage','technical','commercial','common_area')),
  floor             text,
  room_count        smallint,
  living_area_sqm   numeric(10,2),
  ownership_share   numeric(9,6),
  energy_class      text CHECK (energy_class IN ('A','B','C','D','E','F','G')),
  energy_audit_on   date,
  energy_class_valid_until date,
  acquired_on       date,
  disposed_on       date,
  -- PAT-03: a split/merge keeps both sides queryable; the historical link is
  -- carried by unit_lineage, never by deleting the old unit.
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','disposed','archived')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, building_id, code),
  CONSTRAINT unit_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE unit_lineage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  source_unit_id    uuid NOT NULL REFERENCES unit(id),
  target_unit_id    uuid NOT NULL REFERENCES unit(id),
  operation         text NOT NULL CHECK (operation IN ('split','merge','perimeter_change')),
  effective_on      date NOT NULL,
  share             numeric(9,6),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  CHECK (source_unit_id <> target_unit_id)
);

CREATE TABLE unit_usage_period (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  unit_id           uuid NOT NULL REFERENCES unit(id),
  usage             text NOT NULL CHECK (usage IN ('bare_rental','furnished_rental','mobility_rental','tourist_rental','commercial_rental','owner_use','vacant','works','common')),
  starts_on         date NOT NULL,
  ends_on           date,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  CHECK (ends_on IS NULL OR ends_on > starts_on),
  -- PAT-01: a unit cannot hold two usages at once; the history is kept when
  -- the usage changes instead of being rewritten.
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(starts_on, ends_on, '[)') WITH &&
  )
);

CREATE TABLE unit_diagnostic (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  unit_id           uuid REFERENCES unit(id),
  building_id       uuid REFERENCES building(id),
  kind              text NOT NULL CHECK (kind IN ('dpe','asbestos','lead','gas','electricity','erp','noise','termite','other')),
  issued_on         date,
  valid_until       date,
  result_summary    text,
  status            text NOT NULL DEFAULT 'valid' CHECK (status IN ('missing','valid','expiring','expired','unreadable')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(unit_id, building_id) = 1)
);

-- ---------------------------------------------------------------------------
-- 4. People, contact points, dated roles
-- ---------------------------------------------------------------------------

CREATE TABLE person (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  kind              text NOT NULL DEFAULT 'natural' CHECK (kind IN ('natural','legal')),
  display_name      text NOT NULL,
  first_name        text,
  last_name         text,
  company_name      text,
  birth_date        date,
  national_id_ref   text,
  odoo_partner_id   integer,
  -- RGPD-01/03: erasure is a pseudonymization that keeps the business history
  -- intact; the row is never deleted because leases and audit depend on it.
  pseudonymized_at  timestamptz,
  retention_hold    boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','pseudonymized')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT person_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE contact_point (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  person_id         uuid NOT NULL REFERENCES person(id),
  kind              text NOT NULL CHECK (kind IN ('email','phone','mobile','postal','other')),
  value             text NOT NULL,
  label             text,
  is_primary        boolean NOT NULL DEFAULT false,
  -- LOC-02: knowing an address proves nothing about the sender's legal
  -- identity; verification is a separate, dated fact.
  verified_at       timestamptz,
  verification_method text,
  consent_electronic_delivery boolean NOT NULL DEFAULT false,
  consent_recorded_at timestamptz,
  consent_evidence_document_id uuid,
  valid_from        date,
  valid_until       date,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','obsolete','bounced','revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE person_role (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  person_id         uuid NOT NULL REFERENCES person(id),
  role              text NOT NULL CHECK (role IN ('tenant','co_tenant','occupant','guarantor','partner','manager','supplier_contact','insurer_contact','applicant','other')),
  legal_entity_id   uuid REFERENCES legal_entity(id),
  starts_on         date NOT NULL,
  ends_on           date,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- 5. Leases
-- ---------------------------------------------------------------------------

CREATE TABLE lease (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  reference           text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('bare','furnished','mobility','parking','commercial','professional','tourist','other')),
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready_to_sign','signed','active','terminated','archived','cancelled','disputed')),
  signed_on           date,
  starts_on           date,
  ends_on             date,
  duration_months     smallint,
  rent_excl_charges   numeric(14,2),
  charge_regime       text NOT NULL DEFAULT 'provision' CHECK (charge_regime IN ('provision','flat_fee','none','real_expenses')),
  charge_amount       numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  deposit_amount      numeric(14,2),
  payment_day         smallint CHECK (payment_day BETWEEN 1 AND 31),
  payment_in_advance  boolean NOT NULL DEFAULT true,
  term_periodicity    text NOT NULL DEFAULT 'monthly' CHECK (term_periodicity IN ('monthly','quarterly','yearly','stay')),
  proration_rule      text CHECK (proration_rule IN ('calendar_days','thirty_day_month','none')),
  revision_index      text CHECK (revision_index IN ('irl','ilc','ilat','none')),
  revision_reference_quarter text,
  revision_month      smallint CHECK (revision_month BETWEEN 1 AND 12),
  revision_blocked_reason text,
  solidarity          boolean NOT NULL DEFAULT false,
  notice_received_on  date,
  notice_announced_end_on date,
  -- BAI-02/WF-04: an announced departure date is not a legally established one;
  -- it must not terminate the lease on its own.
  notice_legally_established boolean NOT NULL DEFAULT false,
  keys_returned_on    date,
  previous_lease_id   uuid REFERENCES lease(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, reference),
  CONSTRAINT lease_org_id_key UNIQUE (organization_id, id)
);

-- BAI-03: each signed version is immutable; an amendment is a new row linked
-- to the previous one, never an in-place edit of the signed document.
CREATE TABLE lease_version (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  lease_id          uuid NOT NULL REFERENCES lease(id),
  sequence          integer NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('initial','amendment','renewal','transfer')),
  effective_on      date NOT NULL,
  signed_on         date,
  rent_excl_charges numeric(14,2),
  charge_amount     numeric(14,2),
  currency          char(3) NOT NULL DEFAULT 'EUR',
  summary           text,
  signed_document_id uuid,
  frozen_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (lease_id, sequence)
);

CREATE TABLE lease_party (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  lease_id          uuid NOT NULL REFERENCES lease(id),
  person_id         uuid NOT NULL REFERENCES person(id),
  role              text NOT NULL CHECK (role IN ('holder','co_holder','occupant','guarantor','payer_third_party','landlord')),
  starts_on         date NOT NULL,
  ends_on           date,
  is_billing_contact boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  UNIQUE (lease_id, person_id, role, starts_on)
);

CREATE TABLE lease_unit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  lease_id          uuid NOT NULL REFERENCES lease(id),
  unit_id           uuid NOT NULL REFERENCES unit(id),
  role              text NOT NULL DEFAULT 'main' CHECK (role IN ('main','annex')),
  starts_on         date NOT NULL,
  ends_on           date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (lease_id, unit_id, starts_on),
  -- One main unit per lease at a time.
  EXCLUDE USING gist (
    lease_id WITH =,
    daterange(starts_on, ends_on, '[)') WITH &&
  ) WHERE (role = 'main')
);

CREATE TABLE guarantee (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  lease_id          uuid NOT NULL REFERENCES lease(id),
  guarantor_person_id uuid REFERENCES person(id),
  kind              text NOT NULL CHECK (kind IN ('personal_surety','visale','bank_guarantee','company_surety','other')),
  beneficiary_legal_entity_id uuid NOT NULL REFERENCES legal_entity(id),
  is_joint_and_several boolean NOT NULL DEFAULT false,
  starts_on         date,
  ends_on           date,
  scope             text,
  cap_amount        numeric(14,2),
  currency          char(3) NOT NULL DEFAULT 'EUR',
  signed_document_id uuid,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','expired','released','invoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  version           integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- 6. Rent obligations, payments, deposits
-- ---------------------------------------------------------------------------

-- MOD-03 / LOY-01: the obligation identity is (lease, kind, period) and is
-- independent of its revisions. Amounts live in rent_term_version; a revision
-- before posting replaces the authorized draft, a revision after posting
-- produces a linked adjustment, never a second obligation.
CREATE TABLE rent_term (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  lease_id            uuid NOT NULL REFERENCES lease(id),
  kind                text NOT NULL CHECK (kind IN ('rent','charge_provision','charge_flat_fee','charge_regularization','accessory','deposit_call','adjustment','credit_note')),
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  due_on              date NOT NULL,
  status              text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','authorized','posted','partially_settled','settled','disputed','cancelled','payment_rejected')),
  current_version_id  uuid,
  posted_at           timestamptz,
  settled_at          timestamptz,
  adjusts_rent_term_id uuid REFERENCES rent_term(id),
  regularization_run_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (period_end >= period_start),
  CONSTRAINT rent_term_identity_key UNIQUE (lease_id, kind, period_start),
  CONSTRAINT rent_term_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX rent_term_lease_period_idx ON rent_term (lease_id, period_start);
CREATE INDEX rent_term_due_idx ON rent_term (organization_id, status, due_on);

CREATE TABLE rent_term_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  rent_term_id        uuid NOT NULL REFERENCES rent_term(id),
  sequence            integer NOT NULL,
  rent_amount         numeric(14,2) NOT NULL DEFAULT 0,
  charge_amount       numeric(14,2) NOT NULL DEFAULT 0,
  accessory_amount    numeric(14,2) NOT NULL DEFAULT 0,
  total_amount        numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  proration_factor    numeric(9,6),
  rule_version_id     uuid,
  lease_version_id    uuid REFERENCES lease_version(id),
  reason              text NOT NULL CHECK (reason IN ('initial','revision','proration','correction','indexation','regularization')),
  is_posted           boolean NOT NULL DEFAULT false,
  odoo_move_id        integer,
  odoo_move_name      text,
  odoo_read_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (rent_term_id, sequence),
  CHECK (total_amount = rent_amount + charge_amount + accessory_amount)
);

ALTER TABLE rent_term
  ADD CONSTRAINT rent_term_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES rent_term_version(id);

-- IRL-01: the exact index values are kept, not only the resulting rent.
CREATE TABLE rent_revision (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  lease_id            uuid NOT NULL REFERENCES lease(id),
  index_name          text NOT NULL CHECK (index_name IN ('irl','ilc','ilat')),
  reference_quarter   text NOT NULL,
  previous_index_value numeric(9,6) NOT NULL,
  new_index_value     numeric(9,6) NOT NULL,
  base_rent           numeric(14,2) NOT NULL,
  computed_rent_unrounded numeric(18,6) NOT NULL,
  proposed_rent       numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  requested_on        date,
  effective_on        date,
  blocking_reason     text,
  status              text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('blocked','proposed','approved','applied','refused','expired')),
  rule_version_id     uuid,
  approval_id         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE TABLE payment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  direction           text NOT NULL CHECK (direction IN ('inbound','outbound')),
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  received_on         date NOT NULL,
  value_on            date,
  method              text CHECK (method IN ('transfer','direct_debit','card','cheque','cash','platform','offset')),
  payer_person_id     uuid REFERENCES person(id),
  payer_label         text,
  bank_transaction_id uuid REFERENCES bank_transaction(id),
  -- LOY-02: an unallocated receipt stays "to qualify"; it never silently
  -- settles the oldest debt.
  status              text NOT NULL DEFAULT 'to_qualify'
    CHECK (status IN ('to_qualify','partially_allocated','allocated','overpaid','refunded','rejected','cancelled')),
  odoo_payment_id     integer,
  odoo_read_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT payment_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX payment_entity_received_idx ON payment (organization_id, received_on DESC);
CREATE INDEX payment_status_idx ON payment (organization_id, status) WHERE status IN ('to_qualify','partially_allocated','overpaid');

CREATE TABLE deposit_account (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  lease_id            uuid NOT NULL REFERENCES lease(id),
  contractual_amount  numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  restitution_due_on  date,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('expected','open','partially_released','closed','disputed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (lease_id),
  CONSTRAINT deposit_account_org_id_key UNIQUE (organization_id, id)
);

-- F10: the deposit balance is derived from the movements and is a debt of the
-- entity, distinct from the tenant receivable. A retention applied to an
-- already-posted receivable must not create a second revenue line, hence the
-- explicit offset_rent_term_id.
CREATE TABLE deposit_movement (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  deposit_account_id  uuid NOT NULL REFERENCES deposit_account(id),
  kind                text NOT NULL CHECK (kind IN ('received','retained','refunded','transferred','interest','adjustment')),
  amount              numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  occurred_on         date NOT NULL,
  payment_id          uuid REFERENCES payment(id),
  offset_rent_term_id uuid REFERENCES rent_term(id),
  justification_document_id uuid,
  approval_id         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE TABLE payment_allocation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  payment_id          uuid NOT NULL REFERENCES payment(id),
  rent_term_id        uuid REFERENCES rent_term(id),
  deposit_account_id  uuid REFERENCES deposit_account(id),
  amount              numeric(14,2) NOT NULL CHECK (amount <> 0),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  allocated_on        date NOT NULL,
  confirmed_by_odoo   boolean NOT NULL DEFAULT false,
  odoo_reconcile_ref  text,
  odoo_read_at        timestamptz,
  reversed_at         timestamptz,
  reversal_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(rent_term_id, deposit_account_id) = 1)
);
-- Invariant "sum(payment_allocation.amount) <= payment.amount" is enforced by
-- the application and by the nightly control (OPS-02), not by a deferrable
-- trigger: allocations are confirmed asynchronously by Odoo reconciliation
-- (§4) and the intermediate states (partially allocated, reversed after a
-- bank cancellation) are legitimate; a database-level equality would reject
-- exactly the states the spec requires to remain visible.

CREATE INDEX payment_allocation_term_idx ON payment_allocation (rent_term_id) WHERE reversed_at IS NULL;

-- LOY-03: a receipt is issued for a partial payment, a rent receipt only once
-- the rent and its charges are fully settled and confirmed.
CREATE TABLE rent_receipt (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  lease_id            uuid NOT NULL REFERENCES lease(id),
  kind                text NOT NULL CHECK (kind IN ('quittance','recu_partiel')),
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  rent_amount         numeric(14,2) NOT NULL,
  charge_amount       numeric(14,2) NOT NULL,
  total_amount        numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  issued_on           date NOT NULL,
  document_id         uuid,
  delivery_channel    text CHECK (delivery_channel IN ('electronic','postal','handover')),
  delivery_consent_contact_point_id uuid REFERENCES contact_point(id),
  delivery_evidence   text,
  status              text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','delivered','flagged','superseded')),
  flagged_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- 7. Inspections (états des lieux), inventories, equipment
-- ---------------------------------------------------------------------------

CREATE TABLE inspection (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  lease_id            uuid NOT NULL REFERENCES lease(id),
  unit_id             uuid NOT NULL REFERENCES unit(id),
  kind                text NOT NULL CHECK (kind IN ('entry','exit','intermediate')),
  performed_on        date,
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_progress','pending_sync','signed','contested','archived')),
  signed_document_id  uuid,
  signature_evidence  text,
  keys_handed_over_on date,
  -- EDL-01: the 10-day complement window and the heating-period window are
  -- deadlines, not edits of the signed document.
  complement_deadline_on date,
  heating_complement_deadline_on date,
  offline_capture     boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT inspection_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX inspection_lease_idx ON inspection (lease_id, kind, performed_on DESC);

CREATE TABLE inspection_finding (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  inspection_id       uuid NOT NULL REFERENCES inspection(id),
  room                text,
  element             text NOT NULL,
  equipment_id        uuid,
  condition           text CHECK (condition IN ('new','good','fair','worn','damaged','missing','not_checked')),
  description         text,
  -- EDL-03: a finding is an observation; responsibility, wear allowance and
  -- any amount withheld are separate validated decisions (IA-05).
  entry_finding_id    uuid REFERENCES inspection_finding(id),
  is_new_versus_entry boolean,
  proposed_wear_share numeric(9,6),
  decided_amount      numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  decision_approval_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE TABLE inventory_item (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  unit_id             uuid NOT NULL REFERENCES unit(id),
  lease_id            uuid REFERENCES lease(id),
  category            text NOT NULL,
  label               text NOT NULL,
  quantity            numeric(9,3) NOT NULL DEFAULT 1,
  condition           text CHECK (condition IN ('new','good','fair','worn','damaged','missing')),
  purchase_value      numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  equipment_id        uuid,
  present_at_entry    boolean,
  present_at_exit     boolean,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE TABLE equipment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  category            text NOT NULL,
  label               text NOT NULL,
  brand               text,
  model               text,
  serial_number       text,
  qr_code             text,
  purchased_on        date,
  commissioned_on     date,
  documented_cost     numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  warranty_until      date,
  supplier_id         uuid,
  -- EQU-01: the physical equipment and the accounting asset are two linked
  -- objects, not two labels for the same thing.
  fixed_asset_id      uuid,
  status              text NOT NULL DEFAULT 'in_service' CHECK (status IN ('planned','in_service','out_of_service','removed','scrapped')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT equipment_org_id_key UNIQUE (organization_id, id)
);

ALTER TABLE inspection_finding
  ADD CONSTRAINT inspection_finding_equipment_fk FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE inventory_item
  ADD CONSTRAINT inventory_item_equipment_fk FOREIGN KEY (equipment_id) REFERENCES equipment(id);

CREATE TABLE equipment_assignment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  equipment_id        uuid NOT NULL REFERENCES equipment(id),
  unit_id             uuid REFERENCES unit(id),
  building_id         uuid REFERENCES building(id),
  starts_on           date NOT NULL,
  ends_on             date,
  location_note       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(unit_id, building_id) = 1),
  EXCLUDE USING gist (
    equipment_id WITH =,
    daterange(starts_on, ends_on, '[)') WITH &&
  )
);

-- ---------------------------------------------------------------------------
-- 8. Meters
-- ---------------------------------------------------------------------------

CREATE TABLE meter (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  building_id         uuid NOT NULL REFERENCES building(id),
  fluid               text NOT NULL CHECK (fluid IN ('water_cold','water_hot','electricity','gas','heat','pv_production','other')),
  scope               text NOT NULL CHECK (scope IN ('individual','sub_meter','collective')),
  unit_of_measure     text NOT NULL,
  multiplier          numeric(9,6) NOT NULL DEFAULT 1,
  serial_number       text,
  prm_pdl             text,
  pce                 text,
  location_note       text,
  replaced_meter_id   uuid REFERENCES meter(id),
  installed_on        date,
  removed_on          date,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','replaced','removed','faulty')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT meter_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE meter_service_period (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  meter_id            uuid NOT NULL REFERENCES meter(id),
  unit_id             uuid NOT NULL REFERENCES unit(id),
  share               numeric(9,6) NOT NULL DEFAULT 1,
  starts_on           date NOT NULL,
  ends_on             date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (meter_id, unit_id, starts_on)
);

CREATE TABLE meter_reading (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  meter_id            uuid NOT NULL REFERENCES meter(id),
  index_value         numeric(16,4) NOT NULL,
  read_on             date NOT NULL,
  origin              text NOT NULL CHECK (origin IN ('owner','tenant','provider','inspection','estimate','import')),
  inspection_id       uuid REFERENCES inspection(id),
  photo_document_id   uuid,
  is_after_reset      boolean NOT NULL DEFAULT false,
  validated_at        timestamptz,
  validated_by        uuid REFERENCES app_user(id),
  -- COM-01: an index lower than the previous one opens an exception instead of
  -- producing a negative consumption.
  exception_reason    text,
  status              text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','validated','exception','rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (meter_id, read_on, index_value)
);

CREATE INDEX meter_reading_meter_date_idx ON meter_reading (meter_id, read_on DESC);

-- The consumption keeps the two readings and the rule that produced it.
CREATE TABLE meter_consumption (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  meter_id            uuid NOT NULL REFERENCES meter(id),
  from_reading_id     uuid NOT NULL REFERENCES meter_reading(id),
  to_reading_id       uuid NOT NULL REFERENCES meter_reading(id),
  quantity            numeric(16,4) NOT NULL,
  unit_of_measure     text NOT NULL,
  multiplier_applied  numeric(9,6) NOT NULL DEFAULT 1,
  rule_version_id     uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (from_reading_id, to_reading_id)
);

-- ---------------------------------------------------------------------------
-- 9. Suppliers, works, interventions
-- ---------------------------------------------------------------------------

CREATE TABLE supplier (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  name                text NOT NULL,
  trade               text,
  siren               text,
  person_id           uuid REFERENCES person(id),
  odoo_partner_id     integer,
  -- §4: a supplier's payment identity is never changed by an email or an AI
  -- extraction; every change goes through a dedicated human validation.
  payment_iban_last4  text,
  payment_identity_validated_at timestamptz,
  payment_identity_validated_by uuid REFERENCES app_user(id),
  status              text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','blocked','archived')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT supplier_org_id_key UNIQUE (organization_id, id)
);

ALTER TABLE equipment
  ADD CONSTRAINT equipment_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id);

CREATE TABLE works_project (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  building_id         uuid REFERENCES building(id),
  unit_id             uuid REFERENCES unit(id),
  label               text NOT NULL,
  nature              text NOT NULL DEFAULT 'to_qualify'
    CHECK (nature IN ('maintenance','repair','improvement','construction','to_qualify')),
  -- TRA-01: the business category never decides expense vs capitalization;
  -- accounting_treatment stays 'to_qualify' until validated.
  accounting_treatment text NOT NULL DEFAULT 'to_qualify'
    CHECK (accounting_treatment IN ('expense','capitalized','mixed','to_qualify')),
  budget_amount       numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  starts_on           date,
  ends_on             date,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','planned','in_progress','done','cancelled','on_hold')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT works_project_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE intervention (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  works_project_id    uuid REFERENCES works_project(id),
  building_id         uuid REFERENCES building(id),
  unit_id             uuid REFERENCES unit(id),
  equipment_id        uuid REFERENCES equipment(id),
  lease_id            uuid REFERENCES lease(id),
  claim_id            uuid,
  title               text NOT NULL,
  description         text,
  urgency             text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','critical')),
  status              text NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported','qualified','scheduled','in_progress','done','awaiting_part','reopened','cancelled')),
  performed_by        text NOT NULL DEFAULT 'owner' CHECK (performed_by IN ('owner','supplier','tenant','insurer')),
  supplier_id         uuid REFERENCES supplier(id),
  reported_on         date,
  scheduled_on        date,
  completed_on        date,
  unit_unavailable_from date,
  unit_unavailable_to date,
  -- TRA-02: owner hours are an operational fact; their optional hourly value
  -- is a simulated economic cost only and never becomes an expense or asset.
  owner_hours         numeric(9,2),
  owner_hourly_value  numeric(14,2),
  observed_result     text,
  next_check_on       date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (status <> 'done' OR observed_result IS NOT NULL),
  CONSTRAINT intervention_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX intervention_open_idx ON intervention (organization_id, status, urgency)
  WHERE status NOT IN ('done','cancelled');

-- ---------------------------------------------------------------------------
-- 10. Expenses, allocation keys, charge regularization
-- ---------------------------------------------------------------------------

CREATE TABLE expense (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  supplier_id         uuid REFERENCES supplier(id),
  works_project_id    uuid REFERENCES works_project(id),
  intervention_id     uuid REFERENCES intervention(id),
  document_kind       text NOT NULL CHECK (document_kind IN ('receipt','invoice','credit_note','e_invoice','statement')),
  supplier_reference  text,
  issued_on           date,
  total_excl_tax      numeric(14,2),
  tax_amount          numeric(14,2),
  total_incl_tax      numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  -- DEP-02: deduplication combines source id, supplier number, file
  -- fingerprint and similarity; a credit note stays distinct from its invoice.
  source_system       text,
  source_external_id  text,
  file_fingerprint    text,
  duplicate_of_expense_id uuid REFERENCES expense(id),
  credit_note_of_expense_id uuid REFERENCES expense(id),
  payer               text NOT NULL DEFAULT 'entity' CHECK (payer IN ('entity','partner','tenant','insurer','unknown')),
  paid_by_person_id   uuid REFERENCES person(id),
  status              text NOT NULL DEFAULT 'captured'
    CHECK (status IN ('captured','extracted','to_review','validated','posted','paid','reconciled','cancelled','duplicate_suspect','rejected')),
  odoo_move_id        integer,
  odoo_move_name      text,
  odoo_read_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (payer <> 'partner' OR paid_by_person_id IS NOT NULL),
  CONSTRAINT expense_org_id_key UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX expense_source_dedup_idx
  ON expense (organization_id, source_system, source_external_id)
  WHERE source_external_id IS NOT NULL;
CREATE INDEX expense_fingerprint_idx ON expense (organization_id, file_fingerprint);
CREATE INDEX expense_status_idx ON expense (organization_id, status, issued_on DESC);

CREATE TABLE expense_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  expense_id          uuid NOT NULL REFERENCES expense(id),
  line_number         integer NOT NULL,
  description         text NOT NULL,
  quantity            numeric(12,4),
  amount_excl_tax     numeric(14,2),
  tax_amount          numeric(14,2),
  amount_incl_tax     numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  charge_nature       text,
  account_hint        text,
  recoverable_share   numeric(9,6) NOT NULL DEFAULT 0 CHECK (recoverable_share BETWEEN 0 AND 1),
  service_period_start date,
  service_period_end  date,
  allocation_key_version_id uuid,
  -- CHA-01 / FIN-01: what is not allocated stays explicitly unallocated and
  -- remains visible in the totals; it is never silently redistributed.
  unallocated_amount  numeric(14,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (expense_id, line_number)
);

CREATE TABLE charge_allocation_key (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  building_id         uuid REFERENCES building(id),
  legal_entity_id     uuid REFERENCES legal_entity(id),
  code                text NOT NULL,
  label               text NOT NULL,
  basis               text NOT NULL CHECK (basis IN ('tantiemes','surface','consumption','occupants','equal','contractual','other')),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, code),
  CHECK (num_nonnulls(building_id, legal_entity_id) = 1)
);

CREATE TABLE charge_allocation_key_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  allocation_key_id   uuid NOT NULL REFERENCES charge_allocation_key(id),
  sequence            integer NOT NULL,
  effective_from      date NOT NULL,
  effective_to        date,
  -- F06: the residual cent goes to a stable recipient so a replay of the same
  -- computation gives the same distribution.
  rounding_rule       text NOT NULL DEFAULT 'largest_remainder'
    CHECK (rounding_rule IN ('largest_remainder','first_id','last_id','proportional_truncate')),
  justification       text,
  approved_by         uuid REFERENCES app_user(id),
  approved_at         timestamptz,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (allocation_key_id, sequence)
);

ALTER TABLE expense_line
  ADD CONSTRAINT expense_line_key_version_fk
  FOREIGN KEY (allocation_key_version_id) REFERENCES charge_allocation_key_version(id);

CREATE TABLE charge_allocation_share (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  key_version_id      uuid NOT NULL REFERENCES charge_allocation_key_version(id),
  unit_id             uuid REFERENCES unit(id),
  building_id         uuid REFERENCES building(id),
  share               numeric(9,6) NOT NULL CHECK (share >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(unit_id, building_id) = 1)
);
-- CHA-01: "the shares of an active key version total exactly 1" is an
-- application-level invariant checked at activation, because the version is
-- built row by row and can only be complete at the end of the edit.

CREATE TABLE expense_allocation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  expense_line_id     uuid NOT NULL REFERENCES expense_line(id),
  target              text NOT NULL CHECK (target IN ('unit','building_common','entity_common')),
  unit_id             uuid REFERENCES unit(id),
  building_id         uuid REFERENCES building(id),
  legal_entity_id     uuid REFERENCES legal_entity(id),
  amount              numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  recoverable_amount  numeric(14,2) NOT NULL DEFAULT 0,
  key_version_id      uuid REFERENCES charge_allocation_key_version(id),
  rule_version_id     uuid,
  ai_extraction_id    uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (
    (target = 'unit'            AND unit_id IS NOT NULL AND building_id IS NULL     AND legal_entity_id IS NULL) OR
    (target = 'building_common' AND unit_id IS NULL     AND building_id IS NOT NULL AND legal_entity_id IS NULL) OR
    (target = 'entity_common'   AND unit_id IS NULL     AND building_id IS NULL     AND legal_entity_id IS NOT NULL)
  ),
  CHECK (recoverable_amount <= abs(amount))
);

CREATE INDEX expense_allocation_line_idx ON expense_allocation (expense_line_id);
CREATE INDEX expense_allocation_unit_idx ON expense_allocation (unit_id);

-- MOD-01/CHA-01/F05: allocations + explicit residual must equal the line
-- amount to the cent. This one IS enforced in the database, as a DEFERRABLE
-- INITIALLY DEFERRED constraint trigger: the rows are written in one
-- transaction by the allocation engine, so the check can run at COMMIT
-- without blocking intermediate states.
CREATE FUNCTION assert_expense_line_allocation_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_line_id uuid;
  v_amount  numeric(14,2);
  v_residual numeric(14,2);
  v_allocated numeric(14,2);
BEGIN
  v_line_id := COALESCE(NEW.expense_line_id, OLD.expense_line_id);
  SELECT amount_incl_tax, unallocated_amount INTO v_amount, v_residual
    FROM expense_line WHERE id = v_line_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_allocated
    FROM expense_allocation WHERE expense_line_id = v_line_id;
  IF v_allocated + v_residual <> v_amount THEN
    RAISE EXCEPTION
      'expense_line % : allocations (%) + residual (%) <> line amount (%)',
      v_line_id, v_allocated, v_residual, v_amount;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER expense_allocation_balanced
  AFTER INSERT OR UPDATE OR DELETE ON expense_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_expense_line_allocation_balanced();

CREATE TABLE provision_regularization_run (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  building_id         uuid REFERENCES building(id),
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  -- WF-07: validated expenses and recovery rules are frozen into the run; a
  -- later change of an expense does not silently modify a published statement.
  frozen_at           timestamptz,
  rule_version_id     uuid,
  total_recoverable   numeric(14,2),
  total_provisions_called numeric(14,2),
  total_owner_share   numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','computed','frozen','approved','sent','posted','cancelled')),
  approval_id         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (period_end > period_start),
  UNIQUE (organization_id, legal_entity_id, building_id, period_start, period_end)
);

CREATE TABLE provision_regularization_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  run_id              uuid NOT NULL REFERENCES provision_regularization_run(id),
  lease_id            uuid NOT NULL REFERENCES lease(id),
  unit_id             uuid NOT NULL REFERENCES unit(id),
  occupancy_days      integer NOT NULL,
  period_days         integer NOT NULL,
  recoverable_amount  numeric(14,2) NOT NULL,
  provisions_called   numeric(14,2) NOT NULL,
  -- CHA-02 / F11: provisions called but unpaid stay in the tenant account and
  -- are NOT re-invoiced by the regularization.
  provisions_unpaid   numeric(14,2) NOT NULL DEFAULT 0,
  balance_amount      numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  resulting_rent_term_id uuid REFERENCES rent_term(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (run_id, lease_id)
);

ALTER TABLE rent_term
  ADD CONSTRAINT rent_term_regularization_fk
  FOREIGN KEY (regularization_run_id) REFERENCES provision_regularization_run(id);

-- ---------------------------------------------------------------------------
-- 11. Loans, partner current accounts, fixed assets, internal transfers
-- ---------------------------------------------------------------------------

CREATE TABLE loan (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  lender_name         text NOT NULL,
  reference           text NOT NULL,
  principal_amount    numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  released_on         date,
  duration_months     integer,
  rate_kind           text NOT NULL DEFAULT 'fixed' CHECK (rate_kind IN ('fixed','variable','mixed')),
  nominal_rate        numeric(9,6),
  insurance_rate      numeric(9,6),
  deferral_months     integer,
  upfront_fees        numeric(14,2),
  guarantees          text,
  bank_account_id     uuid REFERENCES bank_account(id),
  -- CRE-01: the forecast outstanding principal is NOT the accounting balance;
  -- the official one is read from Odoo with its read date.
  odoo_loan_id        integer,
  odoo_outstanding_principal numeric(14,2),
  odoo_read_at        timestamptz,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','renegotiated','repaid','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, reference),
  CONSTRAINT loan_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE loan_property (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  loan_id             uuid NOT NULL REFERENCES loan(id),
  building_id         uuid REFERENCES building(id),
  unit_id             uuid REFERENCES unit(id),
  financed_share      numeric(9,6),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(building_id, unit_id) = 1)
);

-- CRE-03: a renegotiation adds a schedule version; the previous one stays
-- readable and already-posted installments are not recomputed.
CREATE TABLE loan_schedule_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  loan_id             uuid NOT NULL REFERENCES loan(id),
  sequence            integer NOT NULL,
  reason              text NOT NULL CHECK (reason IN ('initial','renegotiation','rate_change','early_repayment','modulation','correction')),
  effective_from      date NOT NULL,
  source              text CHECK (source IN ('lender_document','manual','computed','import')),
  source_document_id  uuid,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','superseded')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (loan_id, sequence)
);

CREATE TABLE loan_installment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  schedule_version_id uuid NOT NULL REFERENCES loan_schedule_version(id),
  installment_number  integer NOT NULL,
  due_on              date NOT NULL,
  principal_amount    numeric(14,2) NOT NULL DEFAULT 0,
  interest_amount     numeric(14,2) NOT NULL DEFAULT 0,
  insurance_amount    numeric(14,2) NOT NULL DEFAULT 0,
  fees_amount         numeric(14,2) NOT NULL DEFAULT 0,
  total_amount        numeric(14,2) NOT NULL,
  remaining_principal numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  bank_transaction_id uuid REFERENCES bank_transaction(id),
  matched_at          timestamptz,
  variance_reason     text,
  status              text NOT NULL DEFAULT 'forecast'
    CHECK (status IN ('forecast','due','debited','matched','variance','cancelled')),
  odoo_move_id        integer,
  odoo_read_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (schedule_version_id, installment_number),
  -- F01: the three components must total the debited amount exactly.
  CHECK (total_amount = principal_amount + interest_amount + insurance_amount + fees_amount)
);

CREATE INDEX loan_installment_due_idx ON loan_installment (organization_id, due_on);

CREATE TABLE partner_current_account (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  partner_person_id   uuid NOT NULL REFERENCES person(id),
  agreement_document_id uuid,
  interest_rate       numeric(9,6),
  conditions          text,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  -- CCA-01: the official balance comes from Odoo, dated; the SaaS balance is
  -- an operational projection of cca_movement.
  odoo_account_id     integer,
  odoo_balance        numeric(14,2),
  odoo_read_at        timestamptz,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','under_review')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (legal_entity_id, partner_person_id),
  CONSTRAINT partner_current_account_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE cca_movement (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  cca_id              uuid NOT NULL REFERENCES partner_current_account(id),
  kind                text NOT NULL CHECK (kind IN ('contribution','expense_paid_personally','repayment','interest','offset','correction')),
  amount              numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  occurred_on         date NOT NULL,
  -- F02/WF-01: the repayment of the debt must not recreate the expense; the
  -- link to the original expense makes the double effect detectable.
  expense_id          uuid REFERENCES expense(id),
  payment_id          uuid REFERENCES payment(id),
  bank_transaction_id uuid REFERENCES bank_transaction(id),
  approval_id         uuid,
  status              text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','validated','posted','rejected','under_review')),
  odoo_move_id        integer,
  odoo_read_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX cca_movement_account_date_idx ON cca_movement (cca_id, occurred_on DESC);

CREATE TABLE fixed_asset (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  building_id         uuid REFERENCES building(id),
  unit_id             uuid REFERENCES unit(id),
  label               text NOT NULL,
  -- IMM-01: gross value, posted depreciation and NBV are Odoo-owned, read
  -- dated; forecast depreciation lives in a scenario, never here.
  gross_value         numeric(14,2) NOT NULL,
  land_value          numeric(14,2) NOT NULL DEFAULT 0,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  commissioned_on     date,
  duration_years      numeric(9,6),
  method              text CHECK (method IN ('linear','degressive','components','none')),
  accumulated_depreciation numeric(14,2) NOT NULL DEFAULT 0,
  net_book_value      numeric(14,2),
  disposed_on         date,
  odoo_asset_id       integer,
  odoo_read_at        timestamptz,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','fully_depreciated','disposed','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (land_value <= gross_value),
  CONSTRAINT fixed_asset_org_id_key UNIQUE (organization_id, id)
);

ALTER TABLE equipment
  ADD CONSTRAINT equipment_fixed_asset_fk FOREIGN KEY (fixed_asset_id) REFERENCES fixed_asset(id);

CREATE TABLE asset_component (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  fixed_asset_id      uuid NOT NULL REFERENCES fixed_asset(id),
  label               text NOT NULL,
  gross_value         numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  duration_years      numeric(9,6),
  commissioned_on     date,
  replaced_component_id uuid REFERENCES asset_component(id),
  is_depreciable      boolean NOT NULL DEFAULT true,
  equipment_id        uuid REFERENCES equipment(id),
  odoo_asset_id       integer,
  odoo_read_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

-- F09: an internal transfer links the two bank movements and its transit; it
-- is never a revenue, and the fee is a separate expense.
CREATE TABLE internal_transfer (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization(id),
  legal_entity_id         uuid NOT NULL REFERENCES legal_entity(id),
  source_bank_account_id  uuid NOT NULL REFERENCES bank_account(id),
  target_bank_account_id  uuid NOT NULL REFERENCES bank_account(id),
  amount                  numeric(14,2) NOT NULL CHECK (amount > 0),
  currency                char(3) NOT NULL DEFAULT 'EUR',
  initiated_on            date NOT NULL,
  settled_on              date,
  source_transaction_id   uuid REFERENCES bank_transaction(id),
  target_transaction_id   uuid REFERENCES bank_transaction(id),
  fee_expense_id          uuid REFERENCES expense(id),
  status                  text NOT NULL DEFAULT 'in_transit'
    CHECK (status IN ('expected','in_transit','settled','mismatch','cancelled')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz,
  version                 integer NOT NULL DEFAULT 1,
  CHECK (source_bank_account_id <> target_bank_account_id)
);

-- ---------------------------------------------------------------------------
-- 12. Tourist rental
-- ---------------------------------------------------------------------------

CREATE TABLE listing (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  unit_id             uuid NOT NULL REFERENCES unit(id),
  platform            text NOT NULL CHECK (platform IN ('airbnb','booking','abritel','direct','other')),
  external_listing_id text,
  title               text,
  ical_import_url     text,
  ical_export_url     text,
  -- AIR-03: iCal has a documented refresh latency; it is a calendar aid, not
  -- a double-booking guarantee and not financial evidence.
  ical_last_polled_at timestamptz,
  registration_number text,
  registration_checked_on date,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, platform, external_listing_id),
  CONSTRAINT listing_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE booking (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  listing_id          uuid NOT NULL REFERENCES listing(id),
  unit_id             uuid NOT NULL REFERENCES unit(id),
  platform            text NOT NULL,
  external_booking_id text,
  guest_person_id     uuid REFERENCES person(id),
  guest_count         smallint,
  check_in_on         date NOT NULL,
  check_out_on        date NOT NULL,
  nights              integer GENERATED ALWAYS AS (check_out_on - check_in_on) STORED,
  accommodation_amount numeric(14,2) NOT NULL DEFAULT 0,
  cleaning_amount     numeric(14,2) NOT NULL DEFAULT 0,
  commission_amount   numeric(14,2) NOT NULL DEFAULT 0,
  refund_amount       numeric(14,2) NOT NULL DEFAULT 0,
  tourist_tax_collected numeric(14,2) NOT NULL DEFAULT 0,
  tourist_tax_remitted numeric(14,2) NOT NULL DEFAULT 0,
  deposit_amount      numeric(14,2) NOT NULL DEFAULT 0,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  status              text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('blocked','pending','confirmed','in_stay','completed','cancelled','disputed')),
  source              text CHECK (source IN ('ical','file_import','api','manual')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (check_out_on > check_in_on),
  UNIQUE (organization_id, platform, external_booking_id),
  CONSTRAINT booking_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX booking_unit_dates_idx ON booking (unit_id, check_in_on);

CREATE TABLE booking_movement (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  booking_id          uuid NOT NULL REFERENCES booking(id),
  kind                text NOT NULL CHECK (kind IN ('accommodation','cleaning','extra','commission','refund','tourist_tax_collected','tourist_tax_remitted','damage_deposit','adjustment')),
  amount              numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  occurred_on         date NOT NULL,
  -- F04: gross, refunds, commissions and third-party taxes stay separate; the
  -- net transfer is never booked as an additional revenue.
  is_third_party_tax  boolean NOT NULL DEFAULT false,
  external_reference  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE TABLE payout (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid NOT NULL REFERENCES legal_entity(id),
  platform            text NOT NULL,
  external_payout_id  text,
  paid_on             date NOT NULL,
  net_amount          numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  bank_transaction_id uuid REFERENCES bank_transaction(id),
  import_mapping_version text,
  status              text NOT NULL DEFAULT 'imported'
    CHECK (status IN ('imported','matched','variance','confirmed','rejected')),
  variance_amount     numeric(14,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, platform, external_payout_id)
);

CREATE TABLE payout_detail (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  payout_id           uuid NOT NULL REFERENCES payout(id),
  booking_id          uuid REFERENCES booking(id),
  booking_movement_id uuid REFERENCES booking_movement(id),
  label               text,
  amount              numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);
-- AIR-02 / F04: "sum(payout_detail.amount) = payout.net_amount" is an
-- application-level invariant: an unexplained difference must stay visible as
-- payout.variance_amount and block the final confirmation instead of
-- preventing the import rows from being stored at all.

CREATE INDEX payout_detail_payout_idx ON payout_detail (payout_id);

-- ---------------------------------------------------------------------------
-- 13. Insurance and claims
-- ---------------------------------------------------------------------------

CREATE TABLE insurance_policy (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid REFERENCES legal_entity(id),
  kind                text NOT NULL CHECK (kind IN ('pno','habitation','borrower','liability','works','multirisk','other')),
  insurer_name        text NOT NULL,
  policy_number       text NOT NULL,
  insured_person_id   uuid REFERENCES person(id),
  starts_on           date,
  ends_on             date,
  premium_amount      numeric(14,2),
  premium_periodicity text CHECK (premium_periodicity IN ('monthly','quarterly','yearly','single')),
  deductible_amount   numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  guarantees_summary  text,
  exclusions_summary  text,
  contract_document_id uuid,
  last_certificate_document_id uuid,
  last_certificate_checked_at timestamptz,
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','expiring','expired','cancelled','to_verify')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, insurer_name, policy_number),
  CONSTRAINT insurance_policy_org_id_key UNIQUE (organization_id, id)
);

CREATE TABLE policy_scope (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  policy_id           uuid NOT NULL REFERENCES insurance_policy(id),
  building_id         uuid REFERENCES building(id),
  unit_id             uuid REFERENCES unit(id),
  equipment_id        uuid REFERENCES equipment(id),
  lease_id            uuid REFERENCES lease(id),
  loan_id             uuid REFERENCES loan(id),
  starts_on           date,
  ends_on             date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(building_id, unit_id, equipment_id, lease_id, loan_id) = 1)
);

CREATE TABLE claim (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  policy_id           uuid REFERENCES insurance_policy(id),
  building_id         uuid REFERENCES building(id),
  unit_id             uuid REFERENCES unit(id),
  lease_id            uuid REFERENCES lease(id),
  reference           text,
  insurer_claim_number text,
  occurred_on         date,
  declared_on         date,
  facts               text,
  -- SIN-01: alleged liability is stored apart from acknowledged liability.
  alleged_liability   text,
  acknowledged_liability text,
  expert_name         text,
  expert_visit_on     date,
  estimated_damage    numeric(14,2),
  indemnity_expected  numeric(14,2),
  indemnity_received  numeric(14,2),
  deductible_applied  numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  deadline_on         date,
  status              text NOT NULL DEFAULT 'open'
    CHECK (status IN ('draft','declared','open','expertise','settled','refused','closed','litigation')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT claim_org_id_key UNIQUE (organization_id, id)
);

ALTER TABLE intervention
  ADD CONSTRAINT intervention_claim_fk FOREIGN KEY (claim_id) REFERENCES claim(id);

CREATE TABLE claim_indemnity (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  claim_id            uuid NOT NULL REFERENCES claim(id),
  amount              numeric(14,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  received_on         date,
  payment_id          uuid REFERENCES payment(id),
  -- SIN-01: gross amounts are preserved; no automatic netting against repairs.
  kind                text NOT NULL CHECK (kind IN ('advance','final','complement','recovery','deductible')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- 14. Acquisition pipeline (ACQ-01)
-- ---------------------------------------------------------------------------

CREATE TABLE acquisition_opportunity (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  legal_entity_id     uuid REFERENCES legal_entity(id),
  label               text NOT NULL,
  address_line1       text,
  postal_code         text,
  city                text,
  asking_price        numeric(14,2),
  estimated_fees      numeric(14,2),
  estimated_works     numeric(14,2),
  expected_rent_yearly numeric(14,2),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  status              text NOT NULL DEFAULT 'idea'
    CHECK (status IN ('idea','studied','offer_made','under_promise','signed','converted','abandoned')),
  signed_on           date,
  converted_building_id uuid REFERENCES building(id),
  conversion_command_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE TABLE acquisition_scenario (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  opportunity_id      uuid NOT NULL REFERENCES acquisition_opportunity(id),
  label               text NOT NULL,
  is_base             boolean NOT NULL DEFAULT false,
  assumptions         jsonb NOT NULL DEFAULT '{}'::jsonb,
  loan_amount         numeric(14,2),
  equity_amount       numeric(14,2),
  vacancy_rate        numeric(9,6),
  unpaid_rate         numeric(9,6),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- 15. Documents
-- ---------------------------------------------------------------------------

CREATE TABLE document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  title               text NOT NULL,
  nature              text NOT NULL,
  confidentiality     text NOT NULL DEFAULT 'internal'
    CHECK (confidentiality IN ('public_to_tenant','internal','restricted','sensitive')),
  period_start        date,
  period_end          date,
  author_person_id    uuid REFERENCES person(id),
  author_user_id      uuid REFERENCES app_user(id),
  current_version_id  uuid,
  -- RGPD-02: the retention class drives purge/anonymization; a legal hold
  -- (litigation) freezes it without rewriting the history.
  retention_class     text,
  retention_until     date,
  legal_hold          boolean NOT NULL DEFAULT false,
  archived_at         timestamptz,
  purged_at           timestamptz,
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('uploading','active','quarantined','archived','purged','rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT document_org_id_key UNIQUE (organization_id, id)
);

-- DOC-01: the original is preserved; OCR, thumbnails, transcriptions and
-- summaries are derived versions that never replace it.
CREATE TABLE document_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  document_id         uuid NOT NULL REFERENCES document(id),
  sequence            integer NOT NULL,
  role                text NOT NULL DEFAULT 'original'
    CHECK (role IN ('original','signed','ocr_text','transcript','thumbnail','summary','redacted','export')),
  storage_key         text NOT NULL,
  content_type        text NOT NULL,
  byte_size           bigint NOT NULL CHECK (byte_size >= 0),
  sha256              text NOT NULL,
  detected_type       text,
  virus_scan_status   text NOT NULL DEFAULT 'pending'
    CHECK (virus_scan_status IN ('pending','clean','infected','skipped','failed')),
  captured_at         timestamptz,
  received_at         timestamptz NOT NULL DEFAULT now(),
  captured_by_user_id uuid REFERENCES app_user(id),
  metadata_missing    boolean NOT NULL DEFAULT false,
  derived_from_version_id uuid REFERENCES document_version(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (document_id, sequence)
);

ALTER TABLE document
  ADD CONSTRAINT document_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_version(id);

CREATE INDEX document_version_sha_idx ON document_version (organization_id, sha256);

ALTER TABLE contact_point ADD CONSTRAINT contact_point_consent_doc_fk FOREIGN KEY (consent_evidence_document_id) REFERENCES document(id);
ALTER TABLE lease_version ADD CONSTRAINT lease_version_doc_fk FOREIGN KEY (signed_document_id) REFERENCES document(id);
ALTER TABLE guarantee ADD CONSTRAINT guarantee_doc_fk FOREIGN KEY (signed_document_id) REFERENCES document(id);
ALTER TABLE inspection ADD CONSTRAINT inspection_doc_fk FOREIGN KEY (signed_document_id) REFERENCES document(id);
ALTER TABLE deposit_movement ADD CONSTRAINT deposit_movement_doc_fk FOREIGN KEY (justification_document_id) REFERENCES document(id);
ALTER TABLE rent_receipt ADD CONSTRAINT rent_receipt_doc_fk FOREIGN KEY (document_id) REFERENCES document(id);
ALTER TABLE meter_reading ADD CONSTRAINT meter_reading_photo_fk FOREIGN KEY (photo_document_id) REFERENCES document(id);
ALTER TABLE loan_schedule_version ADD CONSTRAINT loan_schedule_doc_fk FOREIGN KEY (source_document_id) REFERENCES document(id);
ALTER TABLE partner_current_account ADD CONSTRAINT cca_agreement_doc_fk FOREIGN KEY (agreement_document_id) REFERENCES document(id);
ALTER TABLE insurance_policy ADD CONSTRAINT insurance_contract_doc_fk FOREIGN KEY (contract_document_id) REFERENCES document(id);
ALTER TABLE insurance_policy ADD CONSTRAINT insurance_certificate_doc_fk FOREIGN KEY (last_certificate_document_id) REFERENCES document(id);

-- ---------------------------------------------------------------------------
-- 16. object_ref — typed registry of linkable objects (MOD-01)
-- ---------------------------------------------------------------------------
--
-- A free (kind, id) pair would let a link point at a row of another
-- organization, at a deleted row, or at nothing at all, and the database could
-- not tell. Instead every linkable object gets one row here, with one nullable
-- real foreign key per target table and a CHECK that exactly one is set. Each
-- of those foreign keys is COMPOSITE — (organization_id, <target>_id) against
-- the target's UNIQUE (organization_id, id) — so a reference across
-- organizations is rejected by the database, not by a service (SEC-01).
-- `kind` is redundant with the populated column but is what queries and
-- indexes filter on; the CHECK keeps it consistent.
-- Timeline link tables (activity_link, event_link, deadline_link,
-- document_link) reference object_ref(id) only, so adding a linkable type is
-- one column here instead of a new link table per pair.

CREATE TABLE object_ref (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  kind                text NOT NULL CHECK (kind IN (
                        'legal_entity','building','unit','person','lease','rent_term','payment',
                        'deposit_account','expense','works_project','intervention','equipment',
                        'meter','loan','partner_current_account','fixed_asset','insurance_policy',
                        'claim','booking','listing','inspection','supplier','bank_account','document')),
  legal_entity_id     uuid,
  building_id         uuid,
  unit_id             uuid,
  person_id           uuid,
  lease_id            uuid,
  rent_term_id        uuid,
  payment_id          uuid,
  deposit_account_id  uuid,
  expense_id          uuid,
  works_project_id    uuid,
  intervention_id     uuid,
  equipment_id        uuid,
  meter_id            uuid,
  loan_id             uuid,
  partner_current_account_id uuid,
  fixed_asset_id      uuid,
  insurance_policy_id uuid,
  claim_id            uuid,
  booking_id          uuid,
  listing_id          uuid,
  inspection_id       uuid,
  supplier_id         uuid,
  bank_account_id     uuid,
  document_id         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,

  CONSTRAINT object_ref_exactly_one CHECK (
    num_nonnulls(
      legal_entity_id, building_id, unit_id, person_id, lease_id, rent_term_id, payment_id,
      deposit_account_id, expense_id, works_project_id, intervention_id, equipment_id,
      meter_id, loan_id, partner_current_account_id, fixed_asset_id, insurance_policy_id,
      claim_id, booking_id, listing_id, inspection_id, supplier_id, bank_account_id, document_id
    ) = 1
  ),
  CONSTRAINT object_ref_kind_matches_column CHECK (
    (kind = 'legal_entity'            AND legal_entity_id IS NOT NULL) OR
    (kind = 'building'                AND building_id IS NOT NULL) OR
    (kind = 'unit'                    AND unit_id IS NOT NULL) OR
    (kind = 'person'                  AND person_id IS NOT NULL) OR
    (kind = 'lease'                   AND lease_id IS NOT NULL) OR
    (kind = 'rent_term'               AND rent_term_id IS NOT NULL) OR
    (kind = 'payment'                 AND payment_id IS NOT NULL) OR
    (kind = 'deposit_account'         AND deposit_account_id IS NOT NULL) OR
    (kind = 'expense'                 AND expense_id IS NOT NULL) OR
    (kind = 'works_project'           AND works_project_id IS NOT NULL) OR
    (kind = 'intervention'            AND intervention_id IS NOT NULL) OR
    (kind = 'equipment'               AND equipment_id IS NOT NULL) OR
    (kind = 'meter'                   AND meter_id IS NOT NULL) OR
    (kind = 'loan'                    AND loan_id IS NOT NULL) OR
    (kind = 'partner_current_account' AND partner_current_account_id IS NOT NULL) OR
    (kind = 'fixed_asset'             AND fixed_asset_id IS NOT NULL) OR
    (kind = 'insurance_policy'        AND insurance_policy_id IS NOT NULL) OR
    (kind = 'claim'                   AND claim_id IS NOT NULL) OR
    (kind = 'booking'                 AND booking_id IS NOT NULL) OR
    (kind = 'listing'                 AND listing_id IS NOT NULL) OR
    (kind = 'inspection'              AND inspection_id IS NOT NULL) OR
    (kind = 'supplier'                AND supplier_id IS NOT NULL) OR
    (kind = 'bank_account'            AND bank_account_id IS NOT NULL) OR
    (kind = 'document'                AND document_id IS NOT NULL)
  ),

  FOREIGN KEY (organization_id, legal_entity_id)            REFERENCES legal_entity(organization_id, id),
  FOREIGN KEY (organization_id, building_id)                REFERENCES building(organization_id, id),
  FOREIGN KEY (organization_id, unit_id)                    REFERENCES unit(organization_id, id),
  FOREIGN KEY (organization_id, person_id)                  REFERENCES person(organization_id, id),
  FOREIGN KEY (organization_id, lease_id)                   REFERENCES lease(organization_id, id),
  FOREIGN KEY (organization_id, rent_term_id)               REFERENCES rent_term(organization_id, id),
  FOREIGN KEY (organization_id, payment_id)                 REFERENCES payment(organization_id, id),
  FOREIGN KEY (organization_id, deposit_account_id)         REFERENCES deposit_account(organization_id, id),
  FOREIGN KEY (organization_id, expense_id)                 REFERENCES expense(organization_id, id),
  FOREIGN KEY (organization_id, works_project_id)           REFERENCES works_project(organization_id, id),
  FOREIGN KEY (organization_id, intervention_id)            REFERENCES intervention(organization_id, id),
  FOREIGN KEY (organization_id, equipment_id)               REFERENCES equipment(organization_id, id),
  FOREIGN KEY (organization_id, meter_id)                   REFERENCES meter(organization_id, id),
  FOREIGN KEY (organization_id, loan_id)                    REFERENCES loan(organization_id, id),
  FOREIGN KEY (organization_id, partner_current_account_id) REFERENCES partner_current_account(organization_id, id),
  FOREIGN KEY (organization_id, fixed_asset_id)             REFERENCES fixed_asset(organization_id, id),
  FOREIGN KEY (organization_id, insurance_policy_id)        REFERENCES insurance_policy(organization_id, id),
  FOREIGN KEY (organization_id, claim_id)                   REFERENCES claim(organization_id, id),
  FOREIGN KEY (organization_id, booking_id)                 REFERENCES booking(organization_id, id),
  FOREIGN KEY (organization_id, listing_id)                 REFERENCES listing(organization_id, id),
  FOREIGN KEY (organization_id, inspection_id)              REFERENCES inspection(organization_id, id),
  FOREIGN KEY (organization_id, supplier_id)                REFERENCES supplier(organization_id, id),
  FOREIGN KEY (organization_id, bank_account_id)            REFERENCES bank_account(organization_id, id),
  FOREIGN KEY (organization_id, document_id)                REFERENCES document(organization_id, id)
);

-- One registry row per target object.
CREATE UNIQUE INDEX object_ref_legal_entity_uk ON object_ref (legal_entity_id) WHERE legal_entity_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_building_uk     ON object_ref (building_id)     WHERE building_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_unit_uk         ON object_ref (unit_id)         WHERE unit_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_person_uk       ON object_ref (person_id)       WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_lease_uk        ON object_ref (lease_id)        WHERE lease_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_rent_term_uk    ON object_ref (rent_term_id)    WHERE rent_term_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_payment_uk      ON object_ref (payment_id)      WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_deposit_uk      ON object_ref (deposit_account_id) WHERE deposit_account_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_expense_uk      ON object_ref (expense_id)      WHERE expense_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_works_uk        ON object_ref (works_project_id) WHERE works_project_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_intervention_uk ON object_ref (intervention_id) WHERE intervention_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_equipment_uk    ON object_ref (equipment_id)    WHERE equipment_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_meter_uk        ON object_ref (meter_id)        WHERE meter_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_loan_uk         ON object_ref (loan_id)         WHERE loan_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_cca_uk          ON object_ref (partner_current_account_id) WHERE partner_current_account_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_asset_uk        ON object_ref (fixed_asset_id)  WHERE fixed_asset_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_policy_uk       ON object_ref (insurance_policy_id) WHERE insurance_policy_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_claim_uk        ON object_ref (claim_id)        WHERE claim_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_booking_uk      ON object_ref (booking_id)      WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_listing_uk      ON object_ref (listing_id)      WHERE listing_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_inspection_uk   ON object_ref (inspection_id)   WHERE inspection_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_supplier_uk     ON object_ref (supplier_id)     WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_bank_account_uk ON object_ref (bank_account_id) WHERE bank_account_id IS NOT NULL;
CREATE UNIQUE INDEX object_ref_document_uk     ON object_ref (document_id)     WHERE document_id IS NOT NULL;
CREATE INDEX object_ref_kind_idx ON object_ref (organization_id, kind);

CREATE TABLE document_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  document_id         uuid NOT NULL REFERENCES document(id),
  object_ref_id       uuid NOT NULL REFERENCES object_ref(id),
  relation            text NOT NULL DEFAULT 'attached'
    CHECK (relation IN ('attached','evidence','signed_contract','certificate','invoice','photo','report','identity','other')),
  effective_from      date,
  effective_to        date,
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (document_id, object_ref_id, relation)
);
-- DOC-01: a document is linked to several objects without being stored twice.

CREATE INDEX document_link_object_idx ON document_link (object_ref_id);

-- ---------------------------------------------------------------------------
-- 17. Timeline: activity, event, deadline
-- ---------------------------------------------------------------------------

CREATE TABLE activity (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  channel             text NOT NULL CHECK (channel IN ('email','sms','phone','note','voice','photo','file','portal','system','whatsapp','platform')),
  direction           text NOT NULL CHECK (direction IN ('inbound','outbound','internal')),
  subject             text,
  -- TMP-01: the raw content stays the source; an AI summary is a versioned
  -- interpretation stored in ai_extraction, never here.
  body_raw            text,
  declared_author     text,
  author_person_id    uuid REFERENCES person(id),
  author_user_id      uuid REFERENCES app_user(id),
  external_id         text,
  captured_at         timestamptz,
  received_at         timestamptz NOT NULL DEFAULT now(),
  occurred_at         timestamptz NOT NULL,
  is_migration_import boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX activity_external_uk ON activity (organization_id, channel, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE event (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  type                text NOT NULL,
  primary_object_ref_id uuid NOT NULL REFERENCES object_ref(id),
  effective_on        date,
  occurred_at         timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  origin              text NOT NULL CHECK (origin IN ('saas','odoo','platform','import','rule','user')),
  actor_user_id       uuid REFERENCES app_user(id),
  actor_label         text,
  source_activity_id  uuid REFERENCES activity(id),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_migration_import boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX event_primary_object_idx ON event (primary_object_ref_id, occurred_at DESC);
CREATE INDEX event_type_idx ON event (organization_id, type, occurred_at DESC);

CREATE TABLE deadline (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  type                text NOT NULL,
  title               text NOT NULL,
  due_on              date NOT NULL,
  original_due_on     date,
  remind_from_on      date,
  priority            text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  assignee_user_id    uuid REFERENCES app_user(id),
  rule_version_id     uuid,
  recurrence_rule     text,
  -- TMP-03: an occurrence anchored on the contractual date does not move when
  -- the work is done early; only a rule anchored on execution does.
  recurrence_anchor   text CHECK (recurrence_anchor IN ('contract_date','execution_date','none')),
  parent_deadline_id  uuid REFERENCES deadline(id),
  status              text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','to_process','done','postponed','blocked','cancelled')),
  postponed_reason    text,
  cancelled_reason    text,
  -- TMP-01: completion references an actual fact; the planned date is never
  -- overwritten by the execution date.
  completed_event_id  uuid REFERENCES event(id),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (status <> 'done' OR completed_event_id IS NOT NULL)
);

CREATE INDEX deadline_org_due_idx ON deadline (organization_id, due_on);
CREATE INDEX deadline_open_idx ON deadline (organization_id, status, due_on)
  WHERE status IN ('planned','to_process','postponed','blocked');

-- occurred_at / due_on are denormalized onto the link rows so the per-object
-- timeline is a single index range scan; the application writes them with the
-- parent row in the same transaction.
CREATE TABLE activity_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  activity_id         uuid NOT NULL REFERENCES activity(id),
  object_ref_id       uuid NOT NULL REFERENCES object_ref(id),
  relation            text NOT NULL DEFAULT 'about'
    CHECK (relation IN ('about','from','to','mentions','context')),
  occurred_at         timestamptz NOT NULL,
  -- TMP-02: links carry their own effective dates and reason, so a change of
  -- tenant does not re-attach previous communications to the new occupant.
  effective_from      date,
  effective_to        date,
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (activity_id, object_ref_id, relation)
);

CREATE INDEX activity_link_timeline_idx ON activity_link (object_ref_id, occurred_at DESC);

CREATE TABLE event_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  event_id            uuid NOT NULL REFERENCES event(id),
  object_ref_id       uuid NOT NULL REFERENCES object_ref(id),
  relation            text NOT NULL DEFAULT 'about'
    CHECK (relation IN ('about','primary','impacted','source','context')),
  occurred_at         timestamptz NOT NULL,
  effective_from      date,
  effective_to        date,
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (event_id, object_ref_id, relation)
);

CREATE INDEX event_link_timeline_idx ON event_link (object_ref_id, occurred_at DESC);

CREATE TABLE deadline_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  deadline_id         uuid NOT NULL REFERENCES deadline(id),
  object_ref_id       uuid NOT NULL REFERENCES object_ref(id),
  relation            text NOT NULL DEFAULT 'about'
    CHECK (relation IN ('about','responsible_for','context')),
  due_on              date NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (deadline_id, object_ref_id, relation)
);

CREATE INDEX deadline_link_timeline_idx ON deadline_link (object_ref_id, due_on);

-- ---------------------------------------------------------------------------
-- 18. Inbox and outbound messaging
-- ---------------------------------------------------------------------------

CREATE TABLE inbox_item (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  activity_id         uuid REFERENCES activity(id),
  document_id         uuid REFERENCES document(id),
  source              text NOT NULL CHECK (source IN ('mobile_capture','email_forward','file_drop','sms_paste','voice_note','connector','api','platform_import')),
  source_reference    text,
  proposed_object_ref_id uuid REFERENCES object_ref(id),
  proposed_action     text,
  uncertainty_reason  text,
  -- INB-01: "classified" is neither "posted" nor "sent"; a wrongly attached
  -- item stays recoverable, so the status keeps its own vocabulary.
  status              text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','analyzed','attached','processed','quarantined','ambiguous','suspected_duplicate','rejected')),
  rejected_reason     text,
  duplicate_of_inbox_item_id uuid REFERENCES inbox_item(id),
  processed_at        timestamptz,
  processed_by        uuid REFERENCES app_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX inbox_item_open_idx ON inbox_item (organization_id, status, created_at DESC)
  WHERE status NOT IN ('processed','rejected');

CREATE TABLE message_outbound (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  channel             text NOT NULL CHECK (channel IN ('email','sms','postal','portal')),
  recipient_person_id uuid REFERENCES person(id),
  recipient_contact_point_id uuid REFERENCES contact_point(id),
  recipient_address   text NOT NULL,
  subject             text,
  body                text,
  template_code       text,
  template_version    text,
  related_object_ref_id uuid REFERENCES object_ref(id),
  approval_id         uuid,
  -- MSG-01: a technical acknowledgement is not proof of reading; delivery
  -- may legitimately stay 'unknown'.
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','queued','sent','delivered','unknown','bounced','failed','cancelled')),
  provider            text,
  provider_message_id text,
  dedup_key           text NOT NULL,
  attempts            integer NOT NULL DEFAULT 0,
  first_attempt_at    timestamptz,
  last_attempt_at     timestamptz,
  delivered_at        timestamptz,
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, dedup_key)
);
-- INT-02: the dedup trace is written before the external effect; a replay
-- after a restore (BCP-03) collides on dedup_key instead of sending twice.

CREATE INDEX message_outbound_status_idx ON message_outbound (organization_id, status, created_at);

-- ---------------------------------------------------------------------------
-- 19. Versioned rules and AI extractions
-- ---------------------------------------------------------------------------

CREATE TABLE rule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  code                text NOT NULL,
  domain              text NOT NULL CHECK (domain IN ('rent_indexation','charge_allocation','expense_routing','retention','autonomy','deadline_generation','reconciliation','dunning','tourist_import')),
  label               text NOT NULL,
  -- IA-06: an allocation rule proposed from repeated confirmations is never
  -- created, modified or activated by the LLM; activation is a human decision
  -- and a human correction suspends the rule for review.
  origin              text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','proposed_by_pattern','template')),
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','proposed','active','suspended','retired')),
  suspended_reason    text,
  correction_count    integer NOT NULL DEFAULT 0,
  application_count   integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, code)
);

CREATE TABLE rule_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  rule_id             uuid NOT NULL REFERENCES rule(id),
  sequence            integer NOT NULL,
  definition          jsonb NOT NULL,
  definition_hash     text NOT NULL,
  scope               jsonb NOT NULL DEFAULT '{}'::jsonb,
  examples            jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from      date NOT NULL,
  effective_to        date,
  approved_by         uuid REFERENCES app_user(id),
  approved_at         timestamptz,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded','revoked')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (rule_id, sequence)
);

ALTER TABLE rent_term_version ADD CONSTRAINT rent_term_version_rule_fk FOREIGN KEY (rule_version_id) REFERENCES rule_version(id);
ALTER TABLE rent_revision ADD CONSTRAINT rent_revision_rule_fk FOREIGN KEY (rule_version_id) REFERENCES rule_version(id);
ALTER TABLE meter_consumption ADD CONSTRAINT meter_consumption_rule_fk FOREIGN KEY (rule_version_id) REFERENCES rule_version(id);
ALTER TABLE expense_allocation ADD CONSTRAINT expense_allocation_rule_fk FOREIGN KEY (rule_version_id) REFERENCES rule_version(id);
ALTER TABLE provision_regularization_run ADD CONSTRAINT regularization_rule_fk FOREIGN KEY (rule_version_id) REFERENCES rule_version(id);
ALTER TABLE deadline ADD CONSTRAINT deadline_rule_fk FOREIGN KEY (rule_version_id) REFERENCES rule_version(id);

-- MOD-02: every AI extraction keeps the proposed field, the evidence, the
-- model and version, and the human decision. It never overwrites the source.
CREATE TABLE ai_extraction (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  subject_object_ref_id uuid REFERENCES object_ref(id),
  source_document_version_id uuid REFERENCES document_version(id),
  source_activity_id  uuid REFERENCES activity(id),
  inbox_item_id       uuid REFERENCES inbox_item(id),
  field_path          text NOT NULL,
  proposed_value      text,
  proposed_value_json jsonb,
  confidence          numeric(9,6),
  evidence_excerpt    text,
  evidence_page       integer,
  evidence_bbox       jsonb,
  provider            text NOT NULL,
  model_name          text NOT NULL,
  model_version       text,
  prompt_version      text,
  decision            text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','accepted','corrected','rejected','superseded')),
  decided_value       text,
  decided_by          uuid REFERENCES app_user(id),
  decided_at          timestamptz,
  autonomy_level      char(1) NOT NULL DEFAULT 'A' CHECK (autonomy_level IN ('A','B','C','D')),
  rule_version_id     uuid REFERENCES rule_version(id),
  cost_micros         bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

ALTER TABLE expense_allocation
  ADD CONSTRAINT expense_allocation_ai_fk FOREIGN KEY (ai_extraction_id) REFERENCES ai_extraction(id);

CREATE INDEX ai_extraction_subject_idx ON ai_extraction (subject_object_ref_id, created_at DESC);
CREATE INDEX ai_extraction_pending_idx ON ai_extraction (organization_id, decision) WHERE decision = 'pending';

-- ---------------------------------------------------------------------------
-- 20. Commands, approvals, outbox, external references
-- ---------------------------------------------------------------------------

CREATE TABLE command (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  command_type        text NOT NULL,
  -- ARC-02: the idempotency key is unique per organization and is bound to the
  -- payload hash; the same key with a different payload is rejected (409).
  operation_key       text NOT NULL,
  payload             jsonb NOT NULL,
  payload_hash        text NOT NULL,
  target_object_ref_id uuid REFERENCES object_ref(id),
  expected_version    integer,
  rule_version_id     uuid REFERENCES rule_version(id),
  approval_id         uuid,
  actor_user_id       uuid REFERENCES app_user(id),
  authorization_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  autonomy_level      char(1) NOT NULL DEFAULT 'D' CHECK (autonomy_level IN ('A','B','C','D')),
  status              text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','authorized','sent','confirmed','rejected','unknown_result','conflict','compensation_required','cancelled')),
  error_type          text CHECK (error_type IN ('validation','permission','version_conflict','closed_period','provider_unavailable','quota','ambiguous_reference','unknown_result')),
  error_detail        text,
  external_ref_id     uuid,
  correlation_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT command_idempotency_key UNIQUE (organization_id, operation_key)
);

CREATE INDEX command_status_idx ON command (organization_id, status, created_at);
CREATE INDEX command_unknown_idx ON command (organization_id, created_at)
  WHERE status IN ('unknown_result','conflict','compensation_required');

-- IA-03: an approval is bound to the exact payload hash, a scope, an actor, a
-- rule and an expiry. If the amount, recipient, evidence, rights or object
-- state change, the hash no longer matches and the approval is invalid; the
-- worker revalidates immediately before sending (SYN-01).
CREATE TABLE approval (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  command_id          uuid NOT NULL REFERENCES command(id),
  approved_payload_hash text NOT NULL,
  decision            text NOT NULL CHECK (decision IN ('approved','refused')),
  refusal_reason      text,
  scope               jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_version_id     uuid REFERENCES rule_version(id),
  approver_user_id    uuid NOT NULL REFERENCES app_user(id),
  approved_at         timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      text,
  evidence_object_ref_id uuid REFERENCES object_ref(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CHECK (expires_at > approved_at),
  CHECK (decision = 'approved' OR refusal_reason IS NOT NULL)
);

CREATE UNIQUE INDEX approval_active_uk ON approval (command_id, approved_payload_hash)
  WHERE revoked_at IS NULL AND decision = 'approved';

ALTER TABLE command ADD CONSTRAINT command_approval_fk FOREIGN KEY (approval_id) REFERENCES approval(id);
ALTER TABLE rent_revision ADD CONSTRAINT rent_revision_approval_fk FOREIGN KEY (approval_id) REFERENCES approval(id);
ALTER TABLE deposit_movement ADD CONSTRAINT deposit_movement_approval_fk FOREIGN KEY (approval_id) REFERENCES approval(id);
ALTER TABLE inspection_finding ADD CONSTRAINT inspection_finding_approval_fk FOREIGN KEY (decision_approval_id) REFERENCES approval(id);
ALTER TABLE cca_movement ADD CONSTRAINT cca_movement_approval_fk FOREIGN KEY (approval_id) REFERENCES approval(id);
ALTER TABLE provision_regularization_run ADD CONSTRAINT regularization_approval_fk FOREIGN KEY (approval_id) REFERENCES approval(id);
ALTER TABLE message_outbound ADD CONSTRAINT message_outbound_approval_fk FOREIGN KEY (approval_id) REFERENCES approval(id);
ALTER TABLE acquisition_opportunity ADD CONSTRAINT acquisition_command_fk FOREIGN KEY (conversion_command_id) REFERENCES command(id);

CREATE TABLE command_attempt (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  command_id          uuid NOT NULL REFERENCES command(id),
  attempt_number      integer NOT NULL,
  step                text NOT NULL,
  -- SYN-02: an Odoo call chain is several separate transactions; each step is
  -- recorded so a resume starts from the re-read state, not from zero.
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  outcome             text NOT NULL DEFAULT 'running'
    CHECK (outcome IN ('running','success','failure','timeout','unknown','skipped')),
  http_status         integer,
  provider_fault      text,
  response_excerpt    text,
  worker_id           text,
  lock_generation     bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (command_id, attempt_number, step)
);

CREATE TABLE outbox_entry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  command_id          uuid REFERENCES command(id),
  message_outbound_id uuid REFERENCES message_outbound(id),
  channel             text NOT NULL CHECK (channel IN ('odoo','email','sms','postal','webhook','internal')),
  -- SYN-01: decision, approval, command and outbox entry are written in the
  -- same local transaction; the worker never invents work that was not
  -- committed.
  partition_key       text NOT NULL,
  payload             jsonb NOT NULL,
  payload_hash        text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','leased','sent','confirmed','failed','dead_letter','cancelled')),
  available_at        timestamptz NOT NULL DEFAULT now(),
  attempts            integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 10,
  lease_owner         text,
  lease_expires_at    timestamptz,
  lease_generation    bigint NOT NULL DEFAULT 0,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX outbox_entry_ready_idx ON outbox_entry (status, available_at);
CREATE INDEX outbox_entry_partition_idx ON outbox_entry (partition_key, available_at)
  WHERE status IN ('pending','leased');

-- MOD-02: the external correspondence table. Two unique constraints: one
-- external identity maps to at most one internal object, and one internal
-- object has at most one external identity per model.
CREATE TABLE external_ref (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  system              text NOT NULL DEFAULT 'odoo' CHECK (system IN ('odoo','airbnb','bank','signature','einvoicing','other')),
  odoo_database       text NOT NULL,
  odoo_company_id     integer,
  model               text NOT NULL,
  external_id         text NOT NULL,
  internal_id         uuid NOT NULL,
  internal_table      text NOT NULL,
  object_ref_id       uuid REFERENCES object_ref(id),
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at        timestamptz,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted_remotely','conflict')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT external_ref_external_uk UNIQUE (organization_id, odoo_database, model, external_id),
  CONSTRAINT external_ref_internal_uk UNIQUE (organization_id, model, internal_id)
);

CREATE INDEX external_ref_internal_idx ON external_ref (internal_id);
CREATE INDEX external_ref_lookup_idx ON external_ref (organization_id, model, external_id);

ALTER TABLE command ADD CONSTRAINT command_external_ref_fk FOREIGN KEY (external_ref_id) REFERENCES external_ref(id);

-- SYN-04 / INT-01: one cursor per connector and per logical stream. Gmail
-- history ids, Graph delta tokens and Odoo (write_date, id) pairs are not the
-- same mechanism, so the cursor is opaque and typed by stream.
CREATE TABLE integration_cursor (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  connector           text NOT NULL,
  stream              text NOT NULL,
  cursor_kind         text NOT NULL CHECK (cursor_kind IN ('write_date_id','history_id','delta_token','timestamp','page_token')),
  cursor_value        text,
  overlap_seconds     integer NOT NULL DEFAULT 300,
  last_success_at     timestamptz,
  last_attempt_at     timestamptz,
  last_error          text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  -- OPS-02 / SYN-06: a sweep whose calls all failed must not advance the
  -- cursor and must not read as "nothing found".
  health              text NOT NULL DEFAULT 'healthy' CHECK (health IN ('healthy','degraded','stalled','unavailable')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, connector, stream)
);

-- ---------------------------------------------------------------------------
-- 21. Audit log (SEC-03), search and embeddings
-- ---------------------------------------------------------------------------

-- Append-only and hash-chained per organization: previous_hash + hash make a
-- silent deletion or edit detectable. No UPDATE/DELETE grant is given to the
-- application role; the trigger below refuses them even to the owner.
CREATE TABLE audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  sequence            bigint GENERATED BY DEFAULT AS IDENTITY,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  actor_kind          text NOT NULL CHECK (actor_kind IN ('user','technical','system','connector')),
  actor_user_id       uuid REFERENCES app_user(id),
  actor_label         text,
  object_table        text NOT NULL,
  object_id           uuid,
  object_ref_id       uuid REFERENCES object_ref(id),
  action              text NOT NULL,
  reason              text,
  source              text,
  before_value        jsonb,
  after_value         jsonb,
  approval_id         uuid REFERENCES approval(id),
  correlation_id      uuid,
  result              text NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure','refused','partial')),
  previous_hash       text,
  hash                text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, sequence)
);

CREATE INDEX audit_log_object_idx ON audit_log (organization_id, object_table, object_id, occurred_at DESC);
CREATE INDEX audit_log_correlation_idx ON audit_log (correlation_id);

CREATE FUNCTION refuse_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_mutation();

-- MEM-01: the index is a rebuildable derivative, never the business source.
-- tsv is written by the indexing worker rather than being a generated column,
-- because to_tsvector('french', unaccent(...)) is not IMMUTABLE and cannot be
-- used in a generated column or an expression index without a custom wrapper.
CREATE TABLE search_document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  object_ref_id       uuid NOT NULL REFERENCES object_ref(id),
  source_table        text NOT NULL,
  source_id           uuid NOT NULL,
  title               text,
  body                text,
  tsv                 tsvector NOT NULL,
  language            text NOT NULL DEFAULT 'french',
  -- RGPD-03: rebuilt or purged when the source is rectified or erased.
  indexed_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, source_table, source_id)
);

CREATE INDEX search_document_tsv_idx ON search_document USING gin (tsv);
CREATE INDEX search_document_object_idx ON search_document (object_ref_id);

-- MEM-03 / RGPD-03: embeddings live in their own table so they can be dropped
-- or rebuilt per person, per document or wholesale without touching business
-- rows, and so an intermediate legal archive can be excluded from AI memory.
CREATE TABLE embedding (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  object_ref_id       uuid NOT NULL REFERENCES object_ref(id),
  source_table        text NOT NULL,
  source_id           uuid NOT NULL,
  chunk_index         integer NOT NULL DEFAULT 0,
  chunk_text          text,
  model_name          text NOT NULL,
  model_version       text,
  dimensions          integer NOT NULL,
  -- 1024 is the mistral-embed dimension; another model means a migration of this column (tech pack D-11).
  vector              vector(1024) NOT NULL,
  excluded_from_ai_memory boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, source_table, source_id, chunk_index, model_name)
);

CREATE INDEX embedding_object_idx ON embedding (object_ref_id);
CREATE INDEX embedding_vector_idx ON embedding USING hnsw (vector vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 22. Row-Level Security template
-- ---------------------------------------------------------------------------
--
-- Every tenant table is filtered on current_setting('app.organization_id',
-- true)::uuid. The second argument is `true` so a missing setting yields NULL
-- instead of an error; NULL then matches no row, which fails closed. The API
-- issues, inside the request transaction:
--
--   BEGIN;
--   SET LOCAL app.organization_id = '…';
--   -- statements
--   COMMIT;
--
-- Migrations and the nightly controls run as the owner with
-- `SET LOCAL app.organization_id` set per organization as well; nothing runs
-- with BYPASSRLS except a clearly identified maintenance role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lfsci_app') THEN
    CREATE ROLE lfsci_app NOLOGIN;
  END IF;
END;
$$;

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_tenant_isolation ON organization
  USING (id = current_setting('app.organization_id', true)::uuid)
  WITH CHECK (id = current_setting('app.organization_id', true)::uuid);

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'organization_id'
      AND NOT a.attisdropped
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
        USING (organization_id = current_setting('app.organization_id', true)::uuid)
        WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid)
    $p$, t.relname || '_tenant_isolation', t.relname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO lfsci_app', t.relname);
  END LOOP;
END;
$$;

-- audit_log keeps the isolation policy but not the write-back rights: the
-- append-only trigger already refuses UPDATE/DELETE, and the grant is narrowed
-- so an ordinary session cannot even attempt one.
REVOKE UPDATE, DELETE ON public.audit_log FROM lfsci_app;

GRANT SELECT ON public.organization TO lfsci_app;
GRANT SELECT, UPDATE ON public.app_user TO lfsci_app;
