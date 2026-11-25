-- Billing, accounting, system options and website inquiries.
--
-- Money is stored as integer cents. Every billing table references the
-- client with ON DELETE RESTRICT: a financial record must outlive anything
-- that would otherwise cascade it away. Records are voided, never deleted.

/* --------------------------------------------------------- system options */

CREATE TABLE system_option (
    key         TEXT        PRIMARY KEY,
    value       TEXT        NOT NULL,
    value_type  TEXT        NOT NULL,
    label       TEXT        NOT NULL,
    description TEXT,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    CONSTRAINT system_option_type_valid
        CHECK (value_type IN ('money', 'integer', 'text', 'longtext', 'email'))
);

-- The rate starts at zero on purpose: billing at a made-up number would be
-- worse than billing nothing. The admin console flags it until it is set.
INSERT INTO system_option (key, value, value_type, label, description, sort_order) VALUES
    ('hourly_rate', '0.00', 'money', 'Hourly rate',
     'The rate billed for consulting time, in US dollars per hour. Time is billed in 30-minute blocks at half this rate. Shown on the website and used for every new charge.', 10),
    ('payment_terms_days', '30', 'integer', 'Payment terms (days)',
     'Days between an invoice''s issue date and its due date. Drives the receivables aging.', 20),
    ('invoice_prefix', 'INV-', 'text', 'Invoice number prefix',
     'Prepended to the sequential invoice number, for example INV-0001.', 30),
    ('invoice_notes', 'Thank you for your business. Please include the invoice number with your payment.', 'longtext', 'Invoice footer',
     'Printed at the bottom of every invoice and statement: payment instructions, remittance address.', 40),
    ('inquiry_email', '', 'email', 'Inquiry notification email',
     'Where new consultation requests from the website are sent. Leave blank to use the default admin address.', 50);

/* ----------------------------------------------------- inquiries & clients */

ALTER TABLE engagement DROP CONSTRAINT engagement_status_valid;
ALTER TABLE engagement ADD CONSTRAINT engagement_status_valid
    CHECK (status IN ('inquiry', 'active', 'paused', 'closed'));

ALTER TABLE client
    ADD COLUMN contact_name TEXT,
    ADD COLUMN phone        TEXT,
    ADD COLUMN source       TEXT NOT NULL DEFAULT 'admin',
    ADD CONSTRAINT client_source_valid CHECK (source IN ('admin', 'website'));

-- A free consultation is a real meeting with real time on it, but nothing
-- to bill. The flag carries that through to the charge.
ALTER TABLE appointment
    ADD COLUMN billable BOOLEAN NOT NULL DEFAULT true;

/* ------------------------------------------------------------ time entries */

CREATE TABLE time_entry (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id BIGINT      NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
    started_at     TIMESTAMPTZ NOT NULL,
    ended_at       TIMESTAMPTZ,
    -- Set for a manual entry; a timed one derives its length from the
    -- interval. Running = both null.
    minutes        INTEGER,
    note           TEXT,
    user_id        BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT time_entry_ordered CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT time_entry_minutes_range CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440)
);

CREATE INDEX time_entry_appointment_idx ON time_entry (appointment_id);

-- One running timer per meeting.
CREATE UNIQUE INDEX time_entry_one_running
    ON time_entry (appointment_id) WHERE ended_at IS NULL AND minutes IS NULL;

/* ---------------------------------------------------------------- invoices */

CREATE TABLE invoice (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    number      TEXT        NOT NULL UNIQUE,
    client_id   BIGINT      NOT NULL REFERENCES client (id) ON DELETE RESTRICT,
    issued_on   DATE        NOT NULL,
    due_on      DATE        NOT NULL,
    total_cents BIGINT      NOT NULL,
    notes       TEXT,
    voided_at   TIMESTAMPTZ,
    void_reason TEXT,
    created_by  BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_due_after_issue CHECK (due_on >= issued_on)
);

CREATE INDEX invoice_client_idx ON invoice (client_id, issued_on DESC);

CREATE SEQUENCE invoice_number_seq START 1;

/* ----------------------------------------------------------------- charges */

CREATE TABLE charge (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id      BIGINT      NOT NULL REFERENCES client (id) ON DELETE RESTRICT,
    engagement_id  BIGINT      REFERENCES engagement (id) ON DELETE SET NULL,
    appointment_id BIGINT      REFERENCES appointment (id) ON DELETE SET NULL,
    kind           TEXT        NOT NULL,
    description    TEXT        NOT NULL,
    service_date   DATE        NOT NULL,
    minutes        INTEGER,
    blocks         INTEGER,
    rate_cents     BIGINT,
    -- Negative for a credit adjustment.
    amount_cents   BIGINT      NOT NULL,
    invoice_id     BIGINT      REFERENCES invoice (id) ON DELETE SET NULL,
    voided_at      TIMESTAMPTZ,
    void_reason    TEXT,
    created_by     BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT charge_kind_valid CHECK (kind IN ('meeting', 'adjustment'))
);

CREATE INDEX charge_client_idx ON charge (client_id, service_date DESC);
CREATE INDEX charge_invoice_idx ON charge (invoice_id);

-- A meeting compiles to at most one live charge.
CREATE UNIQUE INDEX charge_one_per_meeting
    ON charge (appointment_id) WHERE voided_at IS NULL AND appointment_id IS NOT NULL;

/* ---------------------------------------------------------------- payments */

CREATE TABLE payment (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id    BIGINT      NOT NULL REFERENCES client (id) ON DELETE RESTRICT,
    invoice_id   BIGINT      REFERENCES invoice (id) ON DELETE SET NULL,
    received_on  DATE        NOT NULL,
    amount_cents BIGINT      NOT NULL,
    method       TEXT        NOT NULL,
    reference    TEXT,
    note         TEXT,
    voided_at    TIMESTAMPTZ,
    void_reason  TEXT,
    created_by   BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_positive CHECK (amount_cents > 0),
    CONSTRAINT payment_method_valid
        CHECK (method IN ('ach', 'wire', 'check', 'card', 'cash', 'other'))
);

CREATE INDEX payment_client_idx ON payment (client_id, received_on DESC);
CREATE INDEX payment_invoice_idx ON payment (invoice_id);
