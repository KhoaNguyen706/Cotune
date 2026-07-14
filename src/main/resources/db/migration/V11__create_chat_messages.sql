-- V11: CHAT — talk about the beat next to the beat.
--
-- Collaborators editing the same grid need a side channel ("try the snare
-- on the off-beat?") and today that conversation leaks out to Discord,
-- taking its context with it. Messages ride the SAME pipeline as note ops —
-- STOMP in, validate, persist, relay out — so chat works across instances
-- the day the relay turns on, for free.
--
-- author_name is DENORMALIZED on purpose, same philosophy as presence
-- labels: the name is stamped server-side from the signed token at post
-- time, costing zero joins to render history — and chat is a historical
-- record, so a later rename does not rewrite what "khoa: sounds muddy"
-- looked like when it was said. author_id survives alongside for the
-- stable per-person color (same hash the cursors use).

CREATE TABLE chat_messages (
    id          UUID          PRIMARY KEY,
    song_id     UUID          NOT NULL REFERENCES songs (id) ON DELETE CASCADE,

    -- SET NULL, not CASCADE: deleting an account must not silently edit
    -- everyone else's conversation history. The name column keeps the
    -- transcript readable after the id is gone.
    author_id   UUID          REFERENCES users (id) ON DELETE SET NULL,
    -- 60 mirrors users.display_name.
    author_name VARCHAR(60)   NOT NULL,

    -- 1000 mirrors ChatMessage.MAX_BODY_LENGTH — a chat line, not a blog.
    body        VARCHAR(1000) NOT NULL,
    created_at  TIMESTAMPTZ   NOT NULL
);

-- The one query chat history has: "latest N for this song, newest first".
-- The composite index serves it without a sort; id breaks the (unlikely)
-- same-microsecond tie so pagination can never show a message twice.
CREATE INDEX idx_chat_messages_song_created ON chat_messages (song_id, created_at DESC, id DESC);
