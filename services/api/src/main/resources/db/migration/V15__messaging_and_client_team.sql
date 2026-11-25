-- Message threads on topics, how a client wants an engagement run, client
-- account roles, and closing an engagement with notes.

/* ------------------------------------------------- how an engagement is run */

-- message: worked through written threads on its topics.
-- video:   worked through meetings.
-- both:    either.
-- Everything that existed before this ran on meetings, so it stays 'video';
-- nothing about an existing engagement changes until someone changes it.
ALTER TABLE engagement
    ADD COLUMN communication TEXT NOT NULL DEFAULT 'video',
    ADD CONSTRAINT engagement_communication_valid
        CHECK (communication IN ('message', 'video', 'both'));

-- Who opened it, when a client opened it from the portal. Null for the ones
-- the firm opened or that came in through the website.
ALTER TABLE engagement
    ADD COLUMN created_by_user_id BIGINT REFERENCES app_user (id) ON DELETE SET NULL;

-- Closing is an event with a reason, not just a status.
ALTER TABLE engagement
    ADD COLUMN closed_on     DATE,
    ADD COLUMN closure_notes TEXT,
    ADD COLUMN closed_by     BIGINT REFERENCES app_user (id) ON DELETE SET NULL;

/* ------------------------------------------------------ client account roles */

-- owner:   the first person who signed up for the client; manages its people.
-- manager: may open engagements and choose who is on them.
-- member:  takes part in the engagements they are on.
ALTER TABLE app_user ADD COLUMN client_role TEXT;

ALTER TABLE client
    ADD COLUMN owner_user_id BIGINT REFERENCES app_user (id) ON DELETE SET NULL;

-- The owner is the earliest login each client has.
UPDATE client c
SET owner_user_id = (
        SELECT u.id FROM app_user u
        WHERE u.client_id = c.id AND u.role = 'CLIENT'
        ORDER BY u.created_at, u.id
        LIMIT 1);

UPDATE app_user u
SET client_role = CASE
        WHEN EXISTS (SELECT 1 FROM client c WHERE c.owner_user_id = u.id) THEN 'owner'
        ELSE 'member' END
WHERE u.role = 'CLIENT';

ALTER TABLE app_user ADD CONSTRAINT app_user_client_role_valid CHECK (
    (role = 'CLIENT' AND client_role IN ('owner', 'manager', 'member'))
    OR (role = 'ADMIN' AND client_role IS NULL)
);

/* ----------------------------------------------------------- topic threads */

-- A post in the conversation on a topic. `minutes` is the time a Data
-- Painters person spent on the reply; it is never set on a client's post.
-- charge_id is filled when that time has been compiled into a charge, which
-- is also what stops it being charged twice.
CREATE TABLE topic_message (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic_id       BIGINT      NOT NULL REFERENCES topic (id) ON DELETE CASCADE,
    author_user_id BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    author_side    TEXT        NOT NULL,
    body           TEXT        NOT NULL,
    minutes        INTEGER,
    charge_id      BIGINT      REFERENCES charge (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT topic_message_side_valid CHECK (author_side IN ('team', 'client')),
    CONSTRAINT topic_message_not_blank CHECK (length(btrim(body)) > 0),
    CONSTRAINT topic_message_minutes_range CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440),
    CONSTRAINT topic_message_time_is_ours CHECK (minutes IS NULL OR author_side = 'team')
);

CREATE INDEX topic_message_topic_idx ON topic_message (topic_id, created_at);
CREATE INDEX topic_message_uncharged_idx ON topic_message (topic_id)
    WHERE minutes IS NOT NULL AND charge_id IS NULL;

-- Library items attached to a reply. The storage key is copied so the link
-- keeps working after the library item is archived.
CREATE TABLE topic_message_attachment (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id    BIGINT NOT NULL REFERENCES topic_message (id) ON DELETE CASCADE,
    media_item_id BIGINT REFERENCES media_item (id) ON DELETE SET NULL,
    storage_key   TEXT   NOT NULL,
    content_type  TEXT   NOT NULL,
    title         TEXT   NOT NULL
);

CREATE INDEX topic_message_attachment_message_idx ON topic_message_attachment (message_id);

/* ------------------------------------------------------------------ billing */

-- Time spent answering in writing is billed like time spent in a meeting.
ALTER TABLE charge DROP CONSTRAINT charge_kind_valid;
ALTER TABLE charge ADD CONSTRAINT charge_kind_valid
    CHECK (kind IN ('meeting', 'adjustment', 'message'));
