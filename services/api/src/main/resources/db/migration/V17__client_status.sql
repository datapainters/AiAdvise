-- A client's own status, set by the firm, rather than one inferred from its
-- engagements: a client can be on hold with work still open, or a prospect
-- we have already opened an engagement for.

ALTER TABLE client ADD COLUMN status TEXT NOT NULL DEFAULT 'prospect';

ALTER TABLE client ADD CONSTRAINT client_status_valid
    CHECK (status IN ('prospect', 'active', 'on_hold', 'former'));

-- Start every existing client where the popup's badge already put it.
UPDATE client c SET status = 'active'
WHERE EXISTS (SELECT 1 FROM engagement e WHERE e.client_id = c.id AND e.status = 'active');
