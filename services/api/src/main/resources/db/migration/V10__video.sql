-- Video meetings on Daily (daily.co).
--
-- A confirmed meeting gets a private Daily room. The room name is the
-- handle for the Daily API; the URL is what a meeting token is appended to.
ALTER TABLE appointment
    ADD COLUMN video_room_name TEXT,
    ADD COLUMN video_room_url  TEXT;

-- Where a time entry came from. A video entry is imported from the call's
-- actual duration; at most one per meeting, so re-importing replaces it.
ALTER TABLE time_entry
    ADD COLUMN source TEXT NOT NULL DEFAULT 'manual',
    ADD CONSTRAINT time_entry_source_valid CHECK (source IN ('timer', 'manual', 'video'));

-- Timed entries are the ones without a typed-in length.
UPDATE time_entry SET source = 'timer' WHERE minutes IS NULL;

CREATE UNIQUE INDEX time_entry_one_video ON time_entry (appointment_id) WHERE source = 'video';
