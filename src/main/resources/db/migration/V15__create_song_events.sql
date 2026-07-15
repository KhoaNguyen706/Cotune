-- Song version history (ROADMAP Phase 3.1): "who deleted my bassline and
-- when, and give it back." The op-log the early sessions deliberately
-- deferred ("ship over op dispatcher") becomes worth it the moment two
-- humans share a song — and the schema was designed so adding it now is
-- a table, not a rewrite.
--
-- Append-only BY CONSTRUCTION: nothing updates or deletes rows here (no
-- version column, no updated_at — a history that can be edited is not a
-- history). bigserial gives a total order that timestamps can't (two ops
-- in the same millisecond still have a winner).
--
-- track_id is a bare uuid ON PURPOSE — no FK to tracks. A lane's deletion
-- must NOT cascade away the record of what happened in it; "that lane was
-- deleted" is exactly the kind of answer history exists to give. The song
-- FK does cascade: when an ADMIN deletes a whole song, its history goes
-- with it (nothing left to restore into).
CREATE TABLE song_events (
    id         bigserial PRIMARY KEY,
    song_id    uuid        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    track_id   uuid        NOT NULL,
    -- NULL = no human did this (the baseline snapshot below).
    actor_id   uuid,
    -- NOTE_ADD | NOTE_REMOVE | PATTERN_SET
    type       varchar(20) NOT NULL,
    -- The event's notes, same JSONB shape as tracks.pattern: one note for
    -- NOTE_ADD/NOTE_REMOVE, the whole grid for PATTERN_SET. One uniform
    -- shape keeps replay a single fold.
    payload    jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The two read shapes: a song's history (newest first) and one lane's
-- replay (oldest first, bounded by an event id).
CREATE INDEX idx_song_events_song ON song_events (song_id, id DESC);
CREATE INDEX idx_song_events_track ON song_events (track_id, id);

-- BASELINE: replay reconstructs a lane by folding its events from empty —
-- which is only correct if the log is complete from the lane's birth.
-- Lanes that predate this table get their current grid as event #1, so
-- history begins "here is where the lane stood when we started recording"
-- instead of silently pretending pre-existing notes never existed.
INSERT INTO song_events (song_id, track_id, type, payload)
SELECT b.song_id, t.id, 'PATTERN_SET', t.pattern
FROM tracks t
         JOIN beats b ON b.id = t.beat_id
WHERE jsonb_array_length(t.pattern) > 0;
