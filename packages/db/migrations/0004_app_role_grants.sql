-- withTenant runs SET LOCAL ROLE lfsci_app so RLS applies to application work.
-- The migration role must therefore be a member of lfsci_app; without this the
-- switch fails and every session silently keeps the owner's BYPASSRLS.
DO $$
BEGIN
  IF current_user <> 'lfsci_app'
     AND NOT pg_has_role(current_user, 'lfsci_app', 'MEMBER') THEN
    EXECUTE format('GRANT lfsci_app TO %I', current_user);
  END IF;
END;
$$;

-- INSERT on a table covers an identity column filled by DEFAULT, but not an
-- explicit nextval(): the audit hash chain allocates audit_log.sequence itself
-- so the number is inside the hashed field set.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO lfsci_app;
