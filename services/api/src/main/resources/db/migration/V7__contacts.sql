-- Companies as their own record, and real contact fields on app_user.
--
-- A company is deliberately NOT the same thing as a client. A client is an
-- organisation the firm has engaged; a company is just the employer printed
-- on a contact's card. They coincide most of the time and diverge exactly
-- when it matters -- a consultant at a partner firm sitting in on a client's
-- engagement belongs to that client's portal and to their own employer.
-- Folding the two together would make that person unrepresentable.

CREATE TABLE company (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness so "Acme" and "ACME" resolve to one record
-- rather than quietly becoming two. Find-or-create in the application reads
-- through this index.
CREATE UNIQUE INDEX company_name_key ON company (lower(name));

ALTER TABLE app_user
    ADD COLUMN first_name TEXT,
    ADD COLUMN last_name  TEXT,
    ADD COLUMN phone      TEXT,
    ADD COLUMN company_id BIGINT REFERENCES company (id) ON DELETE SET NULL;

CREATE INDEX app_user_company_idx ON app_user (company_id);

-- Backfill from display_name so existing rows are not left half-populated.
-- First token is the first name, everything after it the last; wrong for some
-- names, which is why display_name stays the authoritative label and these
-- two are only used where a form needs them separately.
UPDATE app_user
SET first_name = split_part(display_name, ' ', 1),
    last_name  = NULLIF(substr(display_name, strpos(display_name, ' ') + 1), display_name)
WHERE display_name IS NOT NULL;
