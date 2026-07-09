-- V2: tracks. V1 is already applied and checksummed — schema evolution is
-- always a NEW file, never an edit to an old one.

CREATE TABLE tracks (
    id         UUID        PRIMARY KEY,
    -- ON DELETE CASCADE: deleting a song wipes its tracks at the DB level.
    -- We deliberately did NOT model this with a JPA @OneToMany cascade —
    -- the DB enforces it even for writers that bypass the JVM entirely
    -- (manual psql, future services), and it's one DELETE, not N.
    song_id    UUID        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    name       VARCHAR(80) NOT NULL,
    instrument VARCHAR(20) NOT NULL,             -- enum stored as text, see Track.java
    position   INTEGER     NOT NULL CHECK (position >= 0),
    version    BIGINT      NOT NULL,             -- optimistic-lock counter (@Version)
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    -- Two tracks can't occupy the same slot in a song. Also doubles as the
    -- index for "all tracks of song X" lookups (leftmost-prefix rule), so
    -- no separate index on song_id is needed.
    CONSTRAINT uq_tracks_song_position UNIQUE (song_id, position)
);
