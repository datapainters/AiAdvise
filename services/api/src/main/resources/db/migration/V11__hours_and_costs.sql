-- Business hours, and the costs side of engagements.

/* ---------------------------------------------------------- new option types */

ALTER TABLE system_option DROP CONSTRAINT system_option_type_valid;
ALTER TABLE system_option ADD CONSTRAINT system_option_type_valid
    CHECK (value_type IN ('money', 'integer', 'text', 'longtext', 'email', 'hours', 'rate'));

-- Seeded with the rule the booking forms already applied: weekdays, starts
-- from 8:00 with the last meeting ending by 18:00. Hours are held in the
-- business's own time zone, so a visitor elsewhere sees them converted.
INSERT INTO system_option (key, value, value_type, label, description, sort_order) VALUES
    ('business_hours',
     '{"timezone":"America/Chicago","days":{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":null,"sun":null}}',
     'hours', 'Hours of operation',
     'When clients and website visitors can book meetings. A meeting must start and end inside these hours. Admins can still schedule outside them.',
     5),
    ('video_cost_per_participant_minute', '0.004', 'rate', 'Video cost per participant-minute',
     'What Daily charges per participant-minute of video, in US dollars. Used by the Engagement costs report. Check your Daily plan for the current rate.',
     60);

/* ------------------------------------------------------------ video usage */

-- One row per call (Daily "meeting session") held in a meeting's room,
-- copied from Daily's history so costs survive the room being deleted.
CREATE TABLE video_session (
    id                  TEXT        PRIMARY KEY,   -- Daily's session id
    appointment_id      BIGINT      NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
    room_name           TEXT        NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL,
    duration_seconds    INTEGER     NOT NULL,
    participant_seconds BIGINT      NOT NULL,
    max_participants    INTEGER     NOT NULL,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX video_session_appointment_idx ON video_session (appointment_id);

/* ------------------------------------------------------- engagement costs */

-- Costs the firm carries for an engagement, entered by hand: software,
-- subcontractors, travel. Video is computed from video_session instead.
CREATE TABLE engagement_cost (
    id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    engagement_id BIGINT      NOT NULL REFERENCES engagement (id) ON DELETE RESTRICT,
    incurred_on   DATE        NOT NULL,
    category      TEXT        NOT NULL,
    description   TEXT        NOT NULL,
    amount_cents  BIGINT      NOT NULL,
    voided_at     TIMESTAMPTZ,
    created_by    BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT engagement_cost_positive CHECK (amount_cents > 0),
    CONSTRAINT engagement_cost_category_valid
        CHECK (category IN ('software', 'subcontractor', 'travel', 'video', 'other'))
);

CREATE INDEX engagement_cost_engagement_idx ON engagement_cost (engagement_id);
