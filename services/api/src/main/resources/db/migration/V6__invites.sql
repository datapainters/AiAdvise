-- Single-use invite links, replacing the one-time password handoff.
--
-- The stored value is a SHA-256 of the token, never the token itself. Same
-- reasoning as password_hash: a read of this table must not hand someone the
-- means to take over an account. A fast digest is correct here rather than
-- BCrypt -- the token is 256 bits of CSPRNG output, so there is nothing to
-- brute-force, and BCrypt's per-row salt would make lookup by token
-- impossible without scanning every row.

CREATE TABLE invite_token (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    token_hash TEXT        NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    -- Set on redemption. Presence is what makes the invite single-use.
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by BIGINT      REFERENCES app_user (id) ON DELETE SET NULL
);

-- Issuing a new invite supersedes the user's outstanding ones, which is a
-- lookup by user.
CREATE INDEX invite_token_user_idx ON invite_token (user_id, used_at);

-- Accepting an invite is a credential event and belongs in the sign-in audit
-- alongside the rest. The outcome check has to be widened to admit it.
ALTER TABLE login_event
    DROP CONSTRAINT login_event_outcome_valid;

ALTER TABLE login_event
    ADD CONSTRAINT login_event_outcome_valid
        CHECK (outcome IN ('success', 'failure', 'password_change', 'invite_accepted'));
