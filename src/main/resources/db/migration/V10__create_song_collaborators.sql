-- V10: SHARING — the first half of the collaboration phase.
--
-- Until now "who may touch this song" had exactly one answer: the owner
-- (V5). That is a 1:1 relation and it lives fine as a column on `songs`.
-- Sharing makes it 1:N, and an N-sided relation needs its own table — the
-- alternative (an array/JSONB column of user ids on `songs`) cannot carry a
-- per-person ROLE, cannot be indexed for "which songs am I on?", and cannot
-- have a foreign key, so a deleted account would leave dangling ids behind.
--
-- Note what this table does NOT do: it does not replace owner_id. Ownership
-- and membership are different rights — the owner can delete and re-share,
-- a collaborator cannot. Folding the owner in here as just another row with
-- role='OWNER' would make "the song has exactly one owner" an application
-- convention instead of a database fact (nothing would stop two OWNER rows,
-- or zero). Keeping owner_id on `songs` keeps that invariant structural.

CREATE TABLE song_collaborators (
    song_id    UUID        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- EDITOR may change the music; VIEWER may only open and listen.
    -- Deliberately NOT 'OWNER' — see above; ownership is not a membership.
    role       VARCHAR(20) NOT NULL CHECK (role IN ('EDITOR', 'VIEWER')),

    -- Who sent the invite. ON DELETE SET NULL: losing the inviter's account
    -- must not evict the collaborator from the song.
    invited_by UUID        REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL,

    -- COMPOSITE PRIMARY KEY = "a user appears on a song at most once",
    -- enforced by the database rather than by a check-then-insert in Java.
    -- That distinction matters under concurrency: two simultaneous invites
    -- to the same address would both pass an application-level "is this
    -- person already a collaborator?" check and insert twice. Here the
    -- second one hits a unique violation instead, which is why the service
    -- can treat re-sharing as an UPSERT (change the role) with no race.
    PRIMARY KEY (song_id, user_id)
);

-- The PK's leading column already indexes song_id ("who is on this song?"),
-- so this index serves the OTHER direction: "which songs am I on?" — the
-- query behind the Shared-with-me list, which runs on every home page load.
-- A composite PK only accelerates lookups that start at its FIRST column;
-- assuming otherwise is one of the most common Postgres indexing mistakes.
CREATE INDEX idx_song_collaborators_user ON song_collaborators (user_id);

-- ON DELETE CASCADE on song_id means deleting a song sweeps its membership
-- rows; combined with the cascades already on beats/clips/audio, a song
-- delete stays one statement and leaves nothing orphaned.
