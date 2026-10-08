-- Swing: how late every off-beat 16th lands, per BEAT. 0 = straight, 1 =
-- the hardest shuffle (the off-beat pushed half a 16th late, a dotted
-- feel); about 0.67 is the classic triplet swing.
--
-- Per beat, not per song, because "straight intro, swung verse" is the
-- normal case and the beat is the unit the timeline reuses. Stored as a
-- fraction rather than an MPC-style percentage so the client's timing
-- formula is one multiplication with no magic 50.
--
-- DEFAULT 0 backfills every existing beat as straight, which is exactly how
-- it sounds today. CHECK for the same reason as V8's bars: the DB is the
-- last referee, mirrored by Beat.changeSwing.
ALTER TABLE beats
    ADD COLUMN swing double precision NOT NULL DEFAULT 0
        CONSTRAINT beats_swing_range CHECK (swing BETWEEN 0 AND 1);
