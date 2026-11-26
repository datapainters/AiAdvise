-- A topic can be worked on in more than one meeting.
--
-- topic.appointment_id is the meeting a topic was first booked onto, and
-- everything that asks "what is on this agenda" has read it since V5. That
-- stays. This table records the *other* meetings a topic is brought back to,
-- so a topic that was not finished in one meeting can be picked up in the
-- next and gather notes from both. meeting_note was already keyed by
-- (appointment, topic), so the notes themselves needed no change.
CREATE TABLE meeting_topic (
    appointment_id BIGINT      NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
    topic_id       BIGINT      NOT NULL REFERENCES topic (id) ON DELETE CASCADE,
    added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (appointment_id, topic_id)
);

CREATE INDEX meeting_topic_topic_idx ON meeting_topic (topic_id);
