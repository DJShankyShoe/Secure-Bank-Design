-- SecureBank — 02_application.sql
-- `application` schema tables. UUID PKs are app-generated
-- (Python uuid4) — no DB default needed. Money is BIGINT minor units.
-- Tables are created in FK dependency order: users → billers → accounts →
-- transactions → (mfa_backup_codes, contact_preferences, pending_email_changes).

-- users (SR-01, SR-03, SR-09, SR-11)
CREATE TABLE application.users (
  user_id               uuid PRIMARY KEY,
  email                 varchar(254) UNIQUE NOT NULL,            -- RFC 5322; lowercased on write
  email_verified        boolean      NOT NULL DEFAULT FALSE,
  full_name             varchar(120) NOT NULL,
  nric_encrypted        bytea        NOT NULL,                   -- AES-256-GCM (SR-03)
  nric_masked           varchar(9)   NOT NULL,                   -- e.g. T****518H
  password_hash         varchar(255) NOT NULL,                  -- Argon2id (SR-01)
  totp_seed_encrypted   bytea,                                  -- AES-256-GCM; NULL until MFA enrolled (SR-11)
  transaction_pin_hash  varchar(255),                           -- Argon2id distinct params; NULL until set (SR-12)
  role                  varchar(16)  NOT NULL
                          CHECK (role IN ('customer','admin')), -- server-verified every request (FR-08)
  account_status        varchar(16)  NOT NULL DEFAULT 'active'
                          CHECK (account_status IN ('pending','active','locked','suspended','closed')),
                                                                -- pending=registered, TOTP not yet confirmed (FR-01);
                                                                -- locked=brute-force (SR-09); suspended=admin (FR-08)
  failed_login_count    integer      NOT NULL DEFAULT 0,        -- reset on success (SR-09)
  locked_until          timestamptz,                            -- NULL when not locked (SR-09)
  created_at            timestamptz  NOT NULL DEFAULT NOW(),
  updated_at            timestamptz  NOT NULL DEFAULT NOW()
);

-- billers (FR-07) — the authoritative allowlist; endpoint_uri is config-set, never user-supplied.
CREATE TABLE application.billers (
  biller_id        uuid PRIMARY KEY,
  biller_name      varchar(120) NOT NULL,
  biller_category  varchar(32)  NOT NULL
                     CHECK (biller_category IN ('utility','telco','credit_card')),
  endpoint_uri     varchar(255) NOT NULL,
  active           boolean      NOT NULL DEFAULT TRUE
);

-- accounts (FR-02/03/05)
CREATE TABLE application.accounts (
  account_id      uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES application.users (user_id),  -- ownership-checked every read (SR-13)
  account_number  varchar(10) UNIQUE NOT NULL,                           -- server-generated, unguessable (FR-02)
  account_type    varchar(16) NOT NULL CHECK (account_type IN ('savings','current')),
  balance_cents   bigint      NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  status          varchar(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','close_requested','closed')),  -- suspended=admin freeze (FR-08); close_requested=customer request→admin approve (FR-05)
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  closed_at       timestamptz
);
CREATE INDEX idx_accounts_user_id ON application.accounts (user_id);

-- transactions (FR-03/06/07)
CREATE TABLE application.transactions (
  transaction_id            uuid PRIMARY KEY,
  source_account_id         uuid NOT NULL REFERENCES application.accounts (account_id),
  destination_account_id    uuid REFERENCES application.accounts (account_id),  -- NULL if external
  destination_external_ref  varchar(255),
  biller_id                 uuid REFERENCES application.billers (biller_id),    -- NULL unless bill_payment (allowlist)
  amount_cents              bigint      NOT NULL CHECK (amount_cents > 0),
  transaction_type          varchar(16) NOT NULL
                              CHECK (transaction_type IN ('transfer','bill_payment')),
  status                    varchar(16) NOT NULL
                              CHECK (status IN ('pending','complete','failed')),
  reference_number          varchar(32) UNIQUE NOT NULL,
  idempotency_key           uuid UNIQUE NOT NULL,   -- soft ref to session.idempotency_records; NO FK
  pin_verified              boolean     NOT NULL DEFAULT FALSE,  -- TRUE for >= SGD 1000 (SR-12)
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  completed_at              timestamptz
);
CREATE INDEX idx_txn_source_account ON application.transactions (source_account_id);
CREATE INDEX idx_txn_dest_account   ON application.transactions (destination_account_id);
CREATE INDEX idx_txn_biller         ON application.transactions (biller_id);

-- mfa_backup_codes (SR-11) — one-time, hashed, cleared on use.
CREATE TABLE application.mfa_backup_codes (
  code_id      uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES application.users (user_id),
  code_hash    varchar(255) NOT NULL,   -- Argon2id
  consumed_at  timestamptz,             -- NULL until used
  created_at   timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_backup_codes_user_id ON application.mfa_backup_codes (user_id);

-- contact_preferences (FR-04) — checked before sending notifications.
CREATE TABLE application.contact_preferences (
  pref_id             uuid PRIMARY KEY,
  user_id             uuid UNIQUE NOT NULL REFERENCES application.users (user_id),
  notify_on_transfer  boolean NOT NULL DEFAULT TRUE,
  notify_on_login     boolean NOT NULL DEFAULT TRUE
);

-- pending_email_changes (FR-04) — 30-min verification link to the NEW address.
CREATE TABLE application.pending_email_changes (
  change_id                uuid PRIMARY KEY,
  user_id                  uuid NOT NULL REFERENCES application.users (user_id),
  new_email                varchar(254) NOT NULL,
  verification_token_hash  varchar(255) NOT NULL,   -- token hashed before storage
  expires_at               timestamptz  NOT NULL,   -- 30-min lifetime
  created_at               timestamptz  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pending_email_user_id ON application.pending_email_changes (user_id);
CREATE INDEX idx_pending_email_expires ON application.pending_email_changes (expires_at);
