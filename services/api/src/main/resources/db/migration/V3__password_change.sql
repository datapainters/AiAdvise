-- Forced password changes.
--
-- Set when an account is created by an admin with a one-time password, and
-- cleared once the user picks their own. The API refuses to do anything
-- except change the password while this is true, so a handed-over credential
-- cannot quietly stay in use.

ALTER TABLE app_user
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;

-- The bootstrap admin was created with a generated password that was read
-- out of Secrets Manager, so it is in the same category as a handed-over
-- credential and should be rotated on next sign-in.
UPDATE app_user SET must_change_password = true WHERE role = 'ADMIN';
