-- Team members, engagement teams and meeting participants.
--
-- Until now there was one kind of firm-side account: an ADMIN who could do
-- everything. The firm is growing past one person, so staff accounts gain a
-- team role that says what part of the console they work in. The security
-- role stays ADMIN ("is staff"); team_role narrows it.

ALTER TABLE app_user ADD COLUMN team_role TEXT;

-- Everyone who was an admin before this migration keeps full access.
UPDATE app_user SET team_role = 'admin' WHERE role = 'ADMIN';

ALTER TABLE app_user ADD CONSTRAINT app_user_team_role_valid CHECK (
    (role = 'ADMIN' AND team_role IN ('admin', 'billing', 'relations', 'engineer'))
    OR (role = 'CLIENT' AND team_role IS NULL)
);

-- An engagement exists to meet a specific need; the meetings held under it
-- are the work towards that. The goal is what "done" is measured against.
ALTER TABLE engagement ADD COLUMN goal TEXT;

-- Who works on an engagement, from both sides. `role` describes the part a
-- person plays on this engagement, which is independent of what their
-- account may do: an engineer can lead one engagement and assist on another.
CREATE TABLE engagement_member (
    id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    engagement_id BIGINT      NOT NULL REFERENCES engagement (id) ON DELETE CASCADE,
    user_id       BIGINT      NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role          TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT engagement_member_once UNIQUE (engagement_id, user_id),
    CONSTRAINT engagement_member_role_valid CHECK (role IN (
        'lead', 'engineer', 'account_manager', 'billing',
        'sponsor', 'project_owner', 'technical', 'billing_contact', 'stakeholder'))
);

CREATE INDEX engagement_member_user_idx ON engagement_member (user_id);

-- Who a meeting involves. Two independent flags because they are different
-- questions: someone can be on the call without wanting the write-up, and a
-- sponsor often wants the write-up without attending.
CREATE TABLE appointment_participant (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id BIGINT      NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
    user_id        BIGINT      NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role           TEXT        NOT NULL,
    attending      BOOLEAN     NOT NULL DEFAULT true,
    send_summary   BOOLEAN     NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT appointment_participant_once UNIQUE (appointment_id, user_id),
    CONSTRAINT appointment_participant_role_valid CHECK (role IN (
        'lead', 'engineer', 'account_manager', 'billing',
        'sponsor', 'project_owner', 'technical', 'billing_contact', 'stakeholder'))
);

CREATE INDEX appointment_participant_user_idx ON appointment_participant (user_id);

-- When the write-up went out, so completing a meeting twice (complete,
-- reopen, complete) does not mail everyone twice.
ALTER TABLE appointment ADD COLUMN summary_sent_at TIMESTAMPTZ;
