-- Flyway migration: applied exactly once, recorded in flyway_schema_history.
-- Never edit an applied migration (its checksum is recorded) — schema
-- changes are new V2__, V3__ files. History is append-only, like git.

CREATE TABLE songs (
    id             UUID         PRIMARY KEY,          -- generated app-side (GenerationType.UUID)
    title          VARCHAR(120) NOT NULL,
    bpm            INTEGER      NOT NULL CHECK (bpm BETWEEN 20 AND 400),
    time_signature VARCHAR(10)  NOT NULL,
    version        BIGINT       NOT NULL,              -- optimistic-lock counter (@Version)
    created_at     TIMESTAMPTZ  NOT NULL,
    updated_at     TIMESTAMPTZ  NOT NULL
);

-- TIMESTAMPTZ, not TIMESTAMP: Postgres normalizes it to UTC on write.
-- Plain TIMESTAMP stores whatever wall-clock it was handed and loses the
-- zone — the root cause of a whole genre of "times are off by N hours" bugs.
