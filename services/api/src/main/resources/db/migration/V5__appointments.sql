-- Appointments: scheduled meetings, booked by a client against one of their
-- engagements, with their open topics attached as the agenda.
--
-- An appointment carries both client_id and engagement_id even though the
-- engagement already implies the client. Denormalised on purpose: every admin
-- screen filters or groups by client, and the alternative is a join on every
-- one of those reads. A trigger-free constraint keeps the two honest below.

CREATE TABLE appointment (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id        BIGINT      NOT NULL REFERENCES client (id) ON DELETE CASCADE,
    engagement_id    BIGINT      NOT NULL REFERENCES engagement (id) ON DELETE CASCADE,
    starts_at        TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER     NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'requested',
    -- Who asked for it. Null once that account is deleted; the meeting and
    -- its notes outlive the person who booked it.
    requested_by     BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Whole 30-minute blocks only, which is the unit the portal offers.
    -- Eight hours is not a meeting; it is a mistake, so it is rejected here
    -- rather than discovered in a calendar.
    CONSTRAINT appointment_duration_blocks
        CHECK (duration_minutes > 0
               AND duration_minutes % 30 = 0
               AND duration_minutes <= 480),

    -- Start on the hour or the half hour. Evaluated in UTC so the expression
    -- is immutable and the constraint cannot be invalidated by a server
    -- timezone change. Note this is wrong for the handful of zones at a :45
    -- offset; no client is in one, and a check that silently depends on
    -- server configuration would be worse.
    CONSTRAINT appointment_aligned_to_block
        CHECK (date_part('minute', starts_at AT TIME ZONE 'UTC') IN (0, 30)
               AND date_part('second', starts_at AT TIME ZONE 'UTC') = 0),

    CONSTRAINT appointment_status_valid
        CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled'))
);

CREATE INDEX appointment_client_starts_idx ON appointment (client_id, starts_at DESC);
CREATE INDEX appointment_engagement_idx ON appointment (engagement_id);
CREATE INDEX appointment_starts_idx ON appointment (starts_at DESC);

-- Topics become agenda items by pointing at an appointment.
--
-- ON DELETE SET NULL rather than CASCADE: cancelling a meeting must return
-- its topics to the backlog, not destroy work the client typed. The
-- application moves them back to 'proposed' at the same time.
ALTER TABLE topic
    ADD COLUMN desired_outcome TEXT,
    ADD COLUMN appointment_id  BIGINT REFERENCES appointment (id) ON DELETE SET NULL;

CREATE INDEX topic_appointment_idx ON topic (appointment_id);

-- What the engineer writes against each agenda item during the call.
--
-- One note per topic per meeting, enforced by the unique constraint, so the
-- Meeting Manager edits a single row rather than appending a pile of
-- fragments nobody can reconcile afterwards.
CREATE TABLE meeting_note (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id BIGINT      NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
    topic_id       BIGINT      NOT NULL REFERENCES topic (id) ON DELETE CASCADE,
    body           TEXT        NOT NULL,
    author_user_id BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_note_one_per_topic UNIQUE (appointment_id, topic_id)
);

CREATE INDEX meeting_note_appointment_idx ON meeting_note (appointment_id);

-- session_slot was in V1 and was never used by a line of application code.
-- Appointments replace the idea outright, and leaving an unused table named
-- like the new feature is an invitation to wire up the wrong one.
DROP TABLE session_slot;
