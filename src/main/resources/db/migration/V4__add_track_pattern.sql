-- The pattern is a JSONB array of {step, pitch, velocity} events.
--
-- Why JSONB in a column instead of a normalized note_events table:
-- the pattern is always read and written AS A WHOLE (the sequencer loads
-- a track, the user edits, the client saves the full pattern back) — we
-- never query "all C4 notes across songs". Normalizing would buy query
-- power we don't need at the cost of a join on every song load and
-- row-churn on every save. If per-note operations arrive later (real-time
-- collab editing single notes), THAT is the moment to promote this to a
-- table — the same "de-duplicate when the second consumer appears" timing
-- rule, applied to schema design.
--
-- DEFAULT '[]' back-fills the existing rows so the column can be NOT NULL
-- from day one (nullable-then-backfill-then-alter is the dance you do on
-- big tables; ours is dev-scale).
ALTER TABLE tracks
    ADD COLUMN pattern JSONB NOT NULL DEFAULT '[]'::jsonb;
