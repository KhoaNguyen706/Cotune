CREATE TABLE users (
    id            UUID         PRIMARY KEY,          -- generated app-side (GenerationType.UUID)
    email         VARCHAR(320) NOT NULL,             -- 320 = max legal email length (64 local + @ + 255 domain)
    -- We store a HASH, never the password. 100 chars fits bcrypt output
    -- (~60) plus the "{bcrypt}" algorithm prefix the DelegatingPasswordEncoder
    -- adds, with headroom for a future algorithm swap (e.g. "{argon2}").
    password_hash VARCHAR(100) NOT NULL,
    display_name  VARCHAR(60)  NOT NULL,
    role          VARCHAR(20)  NOT NULL,             -- enum stored as text (@Enumerated(STRING)): survives enum reordering
    created_at    TIMESTAMPTZ  NOT NULL,
    updated_at    TIMESTAMPTZ  NOT NULL
);

-- Functional unique index on LOWER(email), not a plain UNIQUE column:
-- the app normalizes emails to lowercase before saving, but the database
-- must enforce the rule even for code paths that forget (imports, manual
-- SQL, a future bug). "Alice@x.com" and "alice@x.com" are the same account.
-- This index — not the existsByEmail() pre-check in the service — is the
-- real guard against duplicate registration under concurrency.
CREATE UNIQUE INDEX uq_users_email_lower ON users (LOWER(email));
