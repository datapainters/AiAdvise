-- The firm's media library, and what was shared on screen during meetings.

-- Templates (PDF), pre-recorded videos and images the host can put on the
-- shared stage during a call. File bytes live in object storage under
-- storage_key; the row is the catalogue entry.
CREATE TABLE media_item (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind         TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    description  TEXT,
    storage_key  TEXT        NOT NULL UNIQUE,
    content_type TEXT        NOT NULL,
    size_bytes   BIGINT,
    -- pending until the browser has finished uploading the file.
    status       TEXT        NOT NULL DEFAULT 'pending',
    archived_at  TIMESTAMPTZ,
    created_by   BIGINT      REFERENCES app_user (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_item_kind_valid CHECK (kind IN ('template', 'video', 'image')),
    CONSTRAINT media_item_status_valid CHECK (status IN ('pending', 'ready'))
);

-- Everything put on the stage in a meeting: a library item by the host, or
-- a screenshot or image uploaded by anyone in the call. Kept so the meeting
-- summary can list it and a late joiner can be shown it.
CREATE TABLE meeting_share (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id BIGINT      NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
    media_item_id  BIGINT      REFERENCES media_item (id) ON DELETE SET NULL,
    storage_key    TEXT        NOT NULL,
    content_type   TEXT        NOT NULL,
    title          TEXT        NOT NULL,
    shared_by_role TEXT        NOT NULL,
    shared_by_name TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_share_role_valid CHECK (shared_by_role IN ('host', 'client', 'guest'))
);

CREATE INDEX meeting_share_appointment_idx ON meeting_share (appointment_id, created_at);
