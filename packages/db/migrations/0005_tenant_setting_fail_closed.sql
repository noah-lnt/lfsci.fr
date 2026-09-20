-- current_setting('app.organization_id', true) returns NULL only while the GUC
-- has never been set on the connection. After the first SET LOCAL it falls back
-- to '' at transaction end, and ''::uuid raises 22P02 instead of filtering.
-- On a pooled connection that turns "the caller forgot the tenant" into an
-- error on every statement rather than a clean empty result, so every policy
-- now maps '' to NULL and keeps failing closed.
DO $$
DECLARE
  p record;
  col text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname LIKE '%\_tenant\_isolation'
     ORDER BY tablename
  LOOP
    col := CASE WHEN p.tablename = 'organization' THEN 'id' ELSE 'organization_id' END;
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
        USING (%I = nullif(current_setting('app.organization_id', true), '')::uuid)
        WITH CHECK (%I = nullif(current_setting('app.organization_id', true), '')::uuid)
    $p$, p.policyname, p.tablename, col, col);
  END LOOP;
END;
$$;
