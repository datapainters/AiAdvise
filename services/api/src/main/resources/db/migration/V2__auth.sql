-- Authentication.
--
-- Users belong to a client, and a client's users see that client's
-- engagements and nothing else. Admins (the firm) have no client and are not
-- scoped. There is deliberately no self-service registration: this is a
-- client portal, so accounts are created by the firm.

CREATE TABLE app_user (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id     BIGINT REFERENCES client (id) ON DELETE CASCADE,
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    display_name  TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'CLIENT',
    enabled       BOOLEAN     NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT app_user_role_valid CHECK (role IN ('CLIENT', 'ADMIN')),

    -- A CLIENT user without a client would see nothing and belong to nobody;
    -- an ADMIN is the firm and is deliberately unscoped.
    CONSTRAINT app_user_client_scope CHECK (
        (role = 'ADMIN' AND client_id IS NULL)
        OR (role = 'CLIENT' AND client_id IS NOT NULL)
    )
);

-- Email is the login identifier. Stored lowercase by the application; the
-- unique index is on the lowercased value so case cannot be used to register
-- a second account for the same address.
CREATE UNIQUE INDEX app_user_email_key ON app_user (lower(email));

CREATE INDEX app_user_client_idx ON app_user (client_id);
