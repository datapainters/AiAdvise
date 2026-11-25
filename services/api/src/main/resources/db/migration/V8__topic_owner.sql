-- Topics become private to the user who created them.
--
-- Until now a topic belonged to an engagement, and an engagement belongs to a
-- client, so every user invited under a client could read -- and close -- the
-- whole client's backlog. That was the authorisation rule the code actually
-- enforced, not an oversight in one query: it was applied consistently on
-- every path. The rule itself is what changes here.
--
-- ON DELETE SET NULL, not CASCADE: removing a user must not destroy the
-- topics they wrote, because those topics may already be agenda items on a
-- meeting that happened, with notes hanging off them. A null creator means
-- "no living owner" and is readable only by admins, which is the same
-- treatment legacy rows get below.

ALTER TABLE topic
    ADD COLUMN created_by_user_id BIGINT REFERENCES app_user (id) ON DELETE SET NULL;

-- Backfill. Existing rows predate the column and carry no record of who
-- typed them, so the creator has to be inferred. The only defensible guess
-- is a user of the same client the topic already belongs to -- that cannot
-- widen who can see the row, because those users can all see it today.
-- Within the client, the earliest-created user is chosen as the most likely
-- author of the oldest data.
--
-- A topic whose client has no users is left null: better an admin-only row
-- than one attributed to someone who could not have written it.
UPDATE topic t
SET created_by_user_id = (
        SELECT u.id
        FROM app_user u
        JOIN engagement e ON e.client_id = u.client_id
        WHERE e.id = t.engagement_id
          AND u.role = 'CLIENT'
        ORDER BY u.created_at, u.id
        LIMIT 1
    )
WHERE t.created_by_user_id IS NULL;

-- The portal's hot query is now (engagement, creator, status): one user's
-- open backlog on one engagement. The V1 index on (engagement_id, status)
-- stays for the admin views, which are still client-wide.
CREATE INDEX topic_owner_idx ON topic (engagement_id, created_by_user_id, status);
