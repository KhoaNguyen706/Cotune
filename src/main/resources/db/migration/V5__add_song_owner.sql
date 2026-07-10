-- Ownership: the foundation for object-level authorization ("may YOU
-- delete THIS song"), which roles alone cannot express.
--
-- NULLable, deliberately: rows created before this migration have no
-- knowable owner, and inventing one (e.g. "assign everything to the first
-- admin") would be a lie in the data. Legacy NULL-owner songs are
-- deletable only by app ADMINs (see SongAccess); every song created from
-- now on gets a real owner at the application layer.
--
-- ON DELETE SET NULL: if an account is ever removed, its songs become
-- ownerless (admin-managed) instead of vanishing with the user or
-- blocking the user's deletion. A deliberate policy choice, encoded in
-- the schema.
ALTER TABLE songs
    ADD COLUMN owner_id UUID REFERENCES users (id) ON DELETE SET NULL;

-- "Songs by owner" will be a hot query the moment the UI grows a
-- "my songs" filter; FK columns almost always deserve an index anyway
-- (Postgres does NOT auto-index FK columns — a classic surprise).
CREATE INDEX idx_songs_owner_id ON songs (owner_id);
