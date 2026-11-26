-- A ledger of one-off maintenance tasks, so each runs exactly once per
-- database however many times the service restarts. See DataReset.
CREATE TABLE maintenance_run (
    token  TEXT        PRIMARY KEY,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    detail TEXT
);
