-- V7: the "big beat" migration. A beat is no longer one instrument lane —
-- it's a NAMED GROUP of instrument lanes (kick + snare + bass + melody
-- playing together), the FL-Studio pattern model:
--
--   Song ─< Beat ("Beat 1", "Beat 2", ...) ─< Track (instrument lane)
--
-- and the arrangement places WHOLE beats: a clip now references a beat,
-- so dropping "Beat 1" on the timeline plays all of its lanes at once.
--
-- Data migration strategy: every existing song gets one starter beat
-- ("Beat 1") that adopts all of its lanes, and existing beat-clips are
-- re-pointed from their lane to that lane's new parent beat — nothing a
-- user built is lost, it just gains a grouping level.

CREATE TABLE beats (
    id         UUID        PRIMARY KEY,
    song_id    UUID        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    name       VARCHAR(80) NOT NULL,
    position   INTEGER     NOT NULL CHECK (position >= 0),
    version    BIGINT      NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    -- Doubles as the "all beats of song X" index (leftmost-prefix rule).
    CONSTRAINT uq_beats_song_position UNIQUE (song_id, position)
);

-- Starter beat for every song (also songs with no lanes yet — the editor
-- expects at least an empty "Beat 1" to select). gen_random_uuid() is
-- built into Postgres 13+.
INSERT INTO beats (id, song_id, name, position, version, created_at, updated_at)
SELECT gen_random_uuid(), s.id, 'Beat 1', 0, 0, now(), now()
FROM songs s;

-- Lanes move from songs to beats.
ALTER TABLE tracks
    ADD COLUMN beat_id UUID REFERENCES beats (id) ON DELETE CASCADE;

UPDATE tracks t
SET beat_id = b.id
FROM beats b
WHERE b.song_id = t.song_id;

ALTER TABLE tracks
    ALTER COLUMN beat_id SET NOT NULL;

-- Slot uniqueness is now per beat, not per song.
ALTER TABLE tracks
    DROP CONSTRAINT uq_tracks_song_position;
ALTER TABLE tracks
    ADD CONSTRAINT uq_tracks_beat_position UNIQUE (beat_id, position);

-- The song is reachable through the beat; keeping song_id would be a
-- denormalization that can silently disagree with beat_id.
ALTER TABLE tracks
    DROP COLUMN song_id;

-- Clips: BEAT placements now point at the beat (the whole groove).
ALTER TABLE clips
    ADD COLUMN beat_id UUID REFERENCES beats (id) ON DELETE CASCADE;

UPDATE clips c
SET beat_id = t.beat_id
FROM tracks t
WHERE c.track_id = t.id;

ALTER TABLE clips
    DROP CONSTRAINT chk_clips_reference;
ALTER TABLE clips
    DROP COLUMN track_id;

ALTER TABLE clips
    ADD CONSTRAINT chk_clips_reference CHECK (
        (type = 'BEAT'  AND beat_id IS NOT NULL AND audio_id IS NULL) OR
        (type = 'AUDIO' AND audio_id IS NOT NULL AND beat_id IS NULL)
    );
