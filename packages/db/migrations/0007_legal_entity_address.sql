-- The registered office must appear on every document the SCI issues: a rent
-- receipt identifies the landlord, and a formal notice is only valid when the
-- sender's identity and address are on it. Nullable so the columns are added
-- INSTANT and existing rows keep working until the owner fills them.
ALTER TABLE legal_entity
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN postal_code   text,
  ADD COLUMN city          text,
  ADD COLUMN country       char(2) NOT NULL DEFAULT 'FR',
  ADD COLUMN contact_email text,
  ADD COLUMN contact_phone text;
