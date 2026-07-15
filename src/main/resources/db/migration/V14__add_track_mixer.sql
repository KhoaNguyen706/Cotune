-- Mixer persistence (ROADMAP Phase 3.3): the mix is part of the song.
-- Until now volume/pan lived in browser state and vanished on reload —
-- musicians expect a mix to survive, and a collaborator should hear it.
--
-- The defaults ARE the sound every existing lane makes today: unity gain,
-- center pan. Backfilling with them changes nothing audible.
--
-- Deliberately NOT here: mute and solo. Those are audition tools — "let me
-- hear this lane alone for a second" — not part of the musical work, and
-- persisting them would mean opening a song that plays back silent lanes
-- with no visible reason why.
ALTER TABLE tracks
    ADD COLUMN volume double precision NOT NULL DEFAULT 1.0,
    ADD COLUMN pan    double precision NOT NULL DEFAULT 0.0;
