-- V12: public listen links.
--
-- listen_token is a CAPABILITY, not a session: whoever holds it may HEAR
-- the song without an account — read-only, playback-shaped, nothing else.
-- NULL means "no public link", the default for every song old and new.
-- Revoking sets it back to NULL; re-enabling mints a FRESH token, so a
-- leaked old link dies the moment the owner revokes.
ALTER TABLE songs
    ADD COLUMN listen_token VARCHAR(43);

-- Unique because the token IS the lookup key (findByListenToken must hit
-- exactly one song); partial because most songs will never have one and
-- an index full of NULLs indexes nothing.
CREATE UNIQUE INDEX ux_songs_listen_token
    ON songs (listen_token)
    WHERE listen_token IS NOT NULL;
