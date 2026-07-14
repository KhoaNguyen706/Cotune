-- V13: the AI feature is invite-only, and the invitation comes from an
-- ADMIN, not from song membership — being allowed into a song's chat and
-- being allowed to spend the app's AI tokens are different powers.
-- FALSE for everyone, including every existing account: access is a
-- deliberate per-person grant (grantAiAccess mutation), never a default.
ALTER TABLE users
    ADD COLUMN ai_access BOOLEAN NOT NULL DEFAULT FALSE;
