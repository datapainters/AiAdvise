-- Engagement dates, notes and files; meetings the firm creates itself.

-- When the engagement is meant to reach its goal. Optional: an open-ended
-- advisory engagement has none.
ALTER TABLE engagement ADD COLUMN due_on DATE;

-- Notes about the engagement as a whole. Meeting notes hang off an agenda
-- topic; these do not, because plenty worth writing down happens between
-- meetings: a phone call, a decision by email, a change of scope.
CREATE TABLE engagement_note (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    engagement_id  BIGINT      NOT NULL REFERENCES engagement (id) ON DELETE CASCADE,
    body           TEXT        NOT NULL,
    author_user_id BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT engagement_note_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX engagement_note_engagement_idx ON engagement_note (engagement_id, created_at DESC);

-- Files attached to an engagement directly, as opposed to things put on
-- screen during one of its meetings (meeting_share). Either a file uploaded
-- for this engagement or a pointer to something in the media library; the
-- storage key is copied so the link survives the library item being archived.
CREATE TABLE engagement_media (
    id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    engagement_id BIGINT      NOT NULL REFERENCES engagement (id) ON DELETE CASCADE,
    media_item_id BIGINT      REFERENCES media_item (id) ON DELETE SET NULL,
    storage_key   TEXT        NOT NULL,
    content_type  TEXT        NOT NULL,
    title         TEXT        NOT NULL,
    added_by      BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX engagement_media_engagement_idx ON engagement_media (engagement_id, created_at DESC);

-- A meeting the firm creates has no client-chosen topics to describe it, so
-- it gets a title of its own. Client-booked meetings leave it null.
ALTER TABLE appointment ADD COLUMN title TEXT;
