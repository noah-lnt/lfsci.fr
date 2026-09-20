-- lfsci.fr — better-auth tables (core + organization + two-factor plugins).
--
-- Hand-written from the field specification better-auth 1.7.5 itself reports
-- (`getAuthTables` with the plugins configured in apps/web/src/server/auth.ts);
-- `@better-auth/cli` is not installed, so nothing here is machine-generated.
--
-- Every table is prefixed `auth_` so the identity store never collides with the
-- application's own `organization` / `app_user` / `membership` (0001_init.sql).
-- The two are kept in step by the database hooks in `auth.ts`: an auth user
-- mirrors into `app_user` with the SAME id, an auth organization into
-- `organization` with the same id and `code` = slug, a member into `membership`.
--
-- Ids are text because better-auth owns their generation; the application
-- generates UUIDv7 (`advanced.database.generateId`), which is what makes the
-- `::uuid` cast in the mirroring inserts valid.
--
-- No row-level security here: these tables carry no `organization_id` and are
-- read through better-auth only, which always filters by session or user id.

CREATE TABLE auth_user (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  email             text NOT NULL UNIQUE,
  email_verified    boolean NOT NULL DEFAULT false,
  image             text,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_session (
  id                      text PRIMARY KEY,
  token                   text NOT NULL UNIQUE,
  user_id                 text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at              timestamptz NOT NULL,
  ip_address              text,
  user_agent              text,
  active_organization_id  text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_session_user_id_idx ON auth_session (user_id);
CREATE INDEX auth_session_expires_at_idx ON auth_session (expires_at);

CREATE TABLE auth_account (
  id                        text PRIMARY KEY,
  account_id                text NOT NULL,
  provider_id               text NOT NULL,
  user_id                   text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_account_user_id_idx ON auth_account (user_id);
CREATE UNIQUE INDEX auth_account_provider_account_idx ON auth_account (provider_id, account_id);

CREATE TABLE auth_verification (
  id          text PRIMARY KEY,
  identifier  text NOT NULL,
  value       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verification_identifier_idx ON auth_verification (identifier);

CREATE TABLE auth_organization (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  logo        text,
  metadata    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_member (
  id               text PRIMARY KEY,
  organization_id  text NOT NULL REFERENCES auth_organization(id) ON DELETE CASCADE,
  user_id          text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'partner_reader',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE auth_invitation (
  id               text PRIMARY KEY,
  organization_id  text NOT NULL REFERENCES auth_organization(id) ON DELETE CASCADE,
  email            text NOT NULL,
  role             text,
  status           text NOT NULL DEFAULT 'pending',
  expires_at       timestamptz NOT NULL,
  inviter_id       text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_invitation_organization_id_idx ON auth_invitation (organization_id);
CREATE INDEX auth_invitation_email_idx ON auth_invitation (email);

CREATE TABLE auth_two_factor (
  id                         text PRIMARY KEY,
  user_id                    text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  secret                     text NOT NULL,
  backup_codes               text NOT NULL,
  verified                   boolean NOT NULL DEFAULT false,
  failed_verification_count  integer NOT NULL DEFAULT 0,
  locked_until               timestamptz
);
CREATE INDEX auth_two_factor_user_id_idx ON auth_two_factor (user_id);

-- The application role is DML-only (GLA lesson): grant next to the CREATE TABLE.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  auth_user, auth_session, auth_account, auth_verification,
  auth_organization, auth_member, auth_invitation, auth_two_factor
  TO lfsci_app;

-- The mirroring hooks insert into these two; 0001 granted reads only.
GRANT INSERT ON public.organization TO lfsci_app;
GRANT INSERT ON public.app_user TO lfsci_app;
