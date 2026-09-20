#!/bin/sh
# Runs once, on an empty data directory, before the application migrations.
# Migration 0006 creates the same two roles when they are absent, but a tracked
# file may not carry a password; this is where the passwords enter the cluster.
set -eu

if [ -z "${APP_DB_PASSWORD:-}" ] || [ -z "${MAINTENANCE_DB_PASSWORD:-}" ]; then
  echo "APP_DB_PASSWORD or MAINTENANCE_DB_PASSWORD unset: application roles left to the migration"
  exit 0
fi

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DB_PASSWORD" \
  --set=maintenance_password="$MAINTENANCE_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE lfsci_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT PASSWORD %L',
  :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lfsci_service')
\gexec
SELECT format(
  'CREATE ROLE lfsci_maintenance LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS INHERIT PASSWORD %L',
  :'maintenance_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lfsci_maintenance')
\gexec
SELECT format('ALTER ROLE lfsci_service PASSWORD %L', :'app_password')
\gexec
SELECT format('ALTER ROLE lfsci_maintenance PASSWORD %L', :'maintenance_password')
\gexec
SQL
