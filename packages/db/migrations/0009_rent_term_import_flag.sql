-- TMP-04: imported history must never trigger a reminder, a deadline or a
-- notification. The flag marks terms written by the migration; the overdue
-- queries exclude them. Nullable-free with a default so the ADD is INSTANT.
ALTER TABLE rent_term
  ADD COLUMN is_migration_import boolean NOT NULL DEFAULT false;
