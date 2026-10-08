-- Effect SENDS per lane (completes the V14 mixer): how much of the lane is
-- fed to the song's shared reverb and delay, 0..1.
--
-- Sends, not per-lane effect instances, because that is how a mixing desk
-- does it, and for its reasons: ONE reverb that every lane feeds puts the
-- whole beat in the same room, and costs one reverb's CPU instead of one per
-- lane. The effect itself lives in the client's audio graph; what belongs to
-- the SONG is how much of each lane goes into it, so that is all that is
-- stored, and a collaborator or a listener hears the same space.
--
-- DEFAULT 0 = dry, which is every lane's sound today.
ALTER TABLE tracks
    ADD COLUMN reverb double precision NOT NULL DEFAULT 0
        CONSTRAINT tracks_reverb_range CHECK (reverb BETWEEN 0 AND 1),
    ADD COLUMN delay  double precision NOT NULL DEFAULT 0
        CONSTRAINT tracks_delay_range CHECK (delay BETWEEN 0 AND 1);
