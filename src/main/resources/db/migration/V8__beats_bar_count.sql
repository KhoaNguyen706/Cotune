-- Beats grow beyond one bar: `bars` is how many 16-step bars the beat's
-- patterns span. Existing beats keep their classic single bar (DEFAULT 1
-- backfills every current row in one statement).
--
-- The range lives in a CHECK because the DB is the last referee: no code
-- path — today's or a future service's — can store a 0-bar or 100-bar
-- beat. 8 bars mirrors Beat.MAX_BARS; both cite this line.
ALTER TABLE beats
    ADD COLUMN bars INT NOT NULL DEFAULT 1
        CONSTRAINT beats_bars_range CHECK (bars BETWEEN 1 AND 8);
