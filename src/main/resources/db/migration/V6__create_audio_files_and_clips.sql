-- V6: the arrangement. Two new concepts:
--
--   audio_files — user-uploaded audio (samples, vocals, full mixes) stored
--   as bytea IN the database. For an MVP this is deliberate: one datastore,
--   one backup, transactional deletes with the song. The moment files grow
--   past a few MB each or traffic matters, promote to object storage
--   (Supabase bucket / S3) and keep only the key here — the REST endpoint
--   contract (/api/audio/{id}) won't change, only its implementation.
--
--   clips — the arrangement timeline, video-editor style. A clip PLACES
--   something (a beat pattern or an audio file) on a lane at a time offset.
--   The same beat can be placed many times: that's the "many beats make a
--   track" model — patterns are reusable material, clips are the edit.

CREATE TABLE audio_files (
    id           UUID         PRIMARY KEY,
    song_id      UUID         NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    filename     VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes   BIGINT       NOT NULL CHECK (size_bytes > 0),
    -- Client-measured duration (decoded length in seconds); the server
    -- never decodes audio, it just stores and streams bytes.
    duration_seconds DOUBLE PRECISION NOT NULL CHECK (duration_seconds > 0),
    data         BYTEA        NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_audio_files_song ON audio_files (song_id);

CREATE TABLE clips (
    id           UUID        PRIMARY KEY,
    song_id      UUID        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    -- Vertical slot on the timeline (0 = top). Lanes are free-form like a
    -- video editor's — NOT bound to instruments; any clip can sit anywhere.
    lane         INTEGER     NOT NULL CHECK (lane >= 0),
    -- Horizontal position/extent in 16th-note steps (16 steps = one bar in
    -- 4/4). Steps, not seconds: the timeline stays valid when BPM changes.
    start_step   INTEGER     NOT NULL CHECK (start_step >= 0),
    length_steps INTEGER     NOT NULL CHECK (length_steps > 0),
    type         VARCHAR(10) NOT NULL,             -- BEAT | AUDIO, see ClipType
    -- Exactly one of these is set, matching `type`. ON DELETE CASCADE:
    -- deleting a beat or an audio file sweeps its placements off the
    -- timeline — a clip pointing at nothing has no meaning.
    track_id     UUID        REFERENCES tracks (id)      ON DELETE CASCADE,
    audio_id     UUID        REFERENCES audio_files (id) ON DELETE CASCADE,
    version      BIGINT      NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,

    CONSTRAINT chk_clips_reference CHECK (
        (type = 'BEAT'  AND track_id IS NOT NULL AND audio_id IS NULL) OR
        (type = 'AUDIO' AND audio_id IS NOT NULL AND track_id IS NULL)
    )
);

CREATE INDEX idx_clips_song ON clips (song_id);
