-- Production database roles (tech pack §11.4).
--
-- Three roles, three jobs:
--   lfsci_app         NOLOGIN, DML only, created by 0001. withTenant switches
--                     into it so RLS applies. Unchanged here except for the
--                     default privileges that make later tables inherit.
--   lfsci_service     the login role web and worker connect as (DATABASE_URL):
--                     no superuser, no BYPASSRLS, no DDL. Its whole privilege
--                     set is lfsci_app's, so forgetting withTenant still
--                     leaves every statement under row-level security.
--   lfsci_maintenance the login role of the worker's admin handle
--                     (DATABASE_ADMIN_URL): BYPASSRLS for the cross-organization
--                     sweeps, owner of the pg-boss schema, and on the business
--                     tables only what those sweeps actually touch.
--
-- Migrations keep running as the database owner, which is neither of the two.
--
-- No password is set here: a tracked file may not carry one. docker/db/init/
-- sets them on a fresh cluster from the environment; an existing cluster gets
-- them from the operator with ALTER ROLE ... PASSWORD.

-- CREATE ROLE and the BYPASSRLS attribute both need a superuser. When the
-- migration runs as a plain database owner the roles must already be there.
DO $$
DECLARE
  is_superuser boolean := current_setting('is_superuser') = 'on';
  missing text[];
BEGIN
  IF NOT is_superuser THEN
    SELECT array_agg(name) INTO missing
      FROM unnest(ARRAY['lfsci_service', 'lfsci_maintenance']) AS name
     WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = name);
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION
        'roles % must be created by a superuser before this migration runs', missing;
    END IF;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lfsci_service') THEN
    ALTER ROLE lfsci_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
  ELSE
    CREATE ROLE lfsci_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lfsci_maintenance') THEN
    ALTER ROLE lfsci_maintenance LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS INHERIT;
  ELSE
    CREATE ROLE lfsci_maintenance LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS INHERIT;
  END IF;
END;
$$;

GRANT lfsci_app TO lfsci_service;

GRANT USAGE ON SCHEMA public TO lfsci_app, lfsci_service, lfsci_maintenance;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- An identity column filled by DEFAULT needs no sequence right, an explicit
-- nextval() does: the audit hash chain allocates audit_log.sequence itself.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lfsci_app;

-- Default privileges belong to the role that will create the later tables,
-- which is whoever runs the migrations.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lfsci_app', current_user);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO lfsci_app', current_user);
END;
$$;

-- listOrganizationIds, the only cross-organization read of the admin handle.
GRANT SELECT ON public.organization TO lfsci_maintenance;
-- reapOrphanedLeases returns crashed leases to pending on boot.
GRANT SELECT, UPDATE ON public.outbox_entry TO lfsci_maintenance;
-- System exchanges carry no organization_id, so RLS hides them from every
-- tenant session; their retention sweep is this role's.
GRANT SELECT, DELETE ON public.integration_exchange TO lfsci_maintenance;
GRANT EXECUTE ON FUNCTION public.purge_integration_exchange(integer) TO lfsci_maintenance;

-- pg-boss owns and migrates its own schema, so the role that connects it must
-- own that schema too. The name follows PGBOSS_SCHEMA; 'pgboss' is its default
-- and the only one the compose files use.
DO $$
DECLARE
  object record;
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO lfsci_maintenance', current_database());

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss') THEN
    RETURN;
  END IF;
  IF current_setting('is_superuser') <> 'on' THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER SCHEMA pgboss OWNER TO lfsci_maintenance';
  FOR object IN
    SELECT c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'S', 'p')
  LOOP
    IF object.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE pgboss.%I OWNER TO lfsci_maintenance', object.relname);
    ELSE
      EXECUTE format('ALTER TABLE pgboss.%I OWNER TO lfsci_maintenance', object.relname);
    END IF;
  END LOOP;
  FOR object IN
    SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'pgboss' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE pgboss.%I OWNER TO lfsci_maintenance', object.typname);
  END LOOP;
END;
$$;
