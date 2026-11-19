-- An append-only record of sign-in attempts.
--
-- app_user.last_login_at only answers "when did this account last get in",
-- which is the least interesting version of the question. The useful ones are
-- about attempts that did not succeed and about where a session came from, and
-- neither survives in a single column.
--
-- email_tried is stored rather than only user_id because a failed attempt
-- often has no matching user -- a typo, or someone guessing addresses. That
-- pattern is exactly what the log is for, so the attempted address has to be
-- kept even when it resolves to nothing.

CREATE TABLE login_event (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Null when the attempt matched no account, or once the account is gone.
    -- Deleting a user must not erase the history of their sign-ins.
    user_id     BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    email_tried TEXT        NOT NULL,
    outcome     TEXT        NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT login_event_outcome_valid
        CHECK (outcome IN ('success', 'failure', 'password_change'))
);

-- Every read of this table is "most recent first", so the index matches.
CREATE INDEX login_event_created_idx ON login_event (created_at DESC);

CREATE INDEX login_event_email_idx ON login_event (lower(email_tried), created_at DESC);
