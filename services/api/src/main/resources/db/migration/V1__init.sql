-- Initial schema for the client portal.
--
-- Scope is deliberately small: clients, the engagements they have with the
-- firm, and the topics they want covered in an upcoming session. Scheduling
-- hangs off engagements rather than clients so a client can run more than one
-- workstream without the calendar collapsing into one queue.

CREATE TABLE client (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT        NOT NULL,
    primary_email TEXT        NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE engagement (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id  BIGINT      NOT NULL REFERENCES client (id) ON DELETE CASCADE,
    title      TEXT        NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'active',
    started_on DATE        NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT engagement_status_valid
        CHECK (status IN ('active', 'paused', 'closed'))
);

CREATE INDEX engagement_client_idx ON engagement (client_id);

CREATE TABLE topic (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    engagement_id BIGINT      NOT NULL REFERENCES engagement (id) ON DELETE CASCADE,
    title         TEXT        NOT NULL,
    detail        TEXT,
    priority      INTEGER     NOT NULL DEFAULT 3,
    status        TEXT        NOT NULL DEFAULT 'proposed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT topic_status_valid
        CHECK (status IN ('proposed', 'scheduled', 'discussed', 'dropped')),
    CONSTRAINT topic_priority_range
        CHECK (priority BETWEEN 1 AND 5)
);

CREATE INDEX topic_engagement_status_idx ON topic (engagement_id, status);

CREATE TABLE session_slot (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    engagement_id BIGINT      NOT NULL REFERENCES engagement (id) ON DELETE CASCADE,
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    booked        BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT session_slot_ordered CHECK (ends_at > starts_at)
);

CREATE INDEX session_slot_engagement_starts_idx
    ON session_slot (engagement_id, starts_at);
