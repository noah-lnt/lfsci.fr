-- Raw integration exchanges, redacted (tech pack §10.1). One row per inbound
-- webhook and per outbound integration call, searchable by request_id so an
-- incident is located from the correlation id before any log is opened.
-- organization_id is nullable: a discovery or health call belongs to no tenant.
-- Those system rows are therefore invisible under RLS and are written and
-- purged by the admin role.

CREATE TABLE integration_exchange (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid REFERENCES organization(id),
  request_id          uuid,
  correlation_id      uuid,
  command_id          uuid REFERENCES command(id),
  integration         text NOT NULL,
  direction           text NOT NULL CHECK (direction IN ('inbound','outbound')),
  operation           text NOT NULL,
  request             jsonb NOT NULL DEFAULT '{}'::jsonb,
  response            jsonb,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','success','client_error','server_error','timeout','rejected','unknown')),
  http_status         integer,
  duration_ms         integer CHECK (duration_ms >= 0),
  error_detail        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX integration_exchange_request_idx ON integration_exchange (request_id, created_at DESC);
CREATE INDEX integration_exchange_created_idx ON integration_exchange (created_at);
CREATE INDEX integration_exchange_scope_idx
  ON integration_exchange (organization_id, integration, created_at DESC);

ALTER TABLE integration_exchange ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_exchange FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_exchange_tenant_isolation ON integration_exchange
  USING (organization_id = current_setting('app.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_exchange TO lfsci_app;

-- 30-day retention. Runs from the admin role: RLS would otherwise limit the
-- delete to the single organization of the calling session.
CREATE FUNCTION purge_integration_exchange(older_than_days integer DEFAULT 30)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  removed integer;
BEGIN
  IF older_than_days < 1 THEN
    RAISE EXCEPTION 'older_than_days must be >= 1, got %', older_than_days;
  END IF;
  DELETE FROM integration_exchange
   WHERE created_at < now() - make_interval(days => older_than_days);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
