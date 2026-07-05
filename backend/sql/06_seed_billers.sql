-- SecureBank — 06_seed_billers.sql
-- Allowlisted biller catalogue (FR-07). endpoint_uri is config-set, never user
-- input. Idempotent: only inserts billers that are not already present by name.
-- Run as the owner/migration role after 02_application.sql.

INSERT INTO application.billers (biller_id, biller_name, biller_category, endpoint_uri, active)
SELECT gen_random_uuid(), v.name, v.cat, v.uri, TRUE
FROM (VALUES
  ('SP Utilities',     'utility',     'https://billers.internal/sp'),
  ('City Power',       'utility',     'https://billers.internal/citypower'),
  ('Singtel',          'telco',       'https://billers.internal/singtel'),
  ('StarHub',          'telco',       'https://billers.internal/starhub'),
  ('DBS Credit Card',  'credit_card', 'https://billers.internal/dbscc'),
  ('UOB Credit Card',  'credit_card', 'https://billers.internal/uobcc')
) AS v(name, cat, uri)
WHERE NOT EXISTS (
  SELECT 1 FROM application.billers b WHERE b.biller_name = v.name
);
