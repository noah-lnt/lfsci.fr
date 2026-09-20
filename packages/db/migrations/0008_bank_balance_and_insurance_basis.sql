-- The bank balance is Odoo's, not ours: store it as a dated read-only copy like
-- every other ledger-owned figure, so the screens stop reconstructing one.
ALTER TABLE bank_account
  ADD COLUMN odoo_balance    numeric(14,2),
  ADD COLUMN odoo_balance_on date,
  ADD COLUMN odoo_read_at    timestamptz;

-- Some lenders price the premium on the outstanding balance instead of the
-- initial principal. The default reproduces what the schedules already stored.
ALTER TABLE loan
  ADD COLUMN insurance_basis text NOT NULL DEFAULT 'initial_principal'
    CHECK (insurance_basis IN ('initial_principal','outstanding_principal'));
