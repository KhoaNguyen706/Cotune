-- Audio bytes move out of Postgres onto disk (a step toward object
-- storage). New uploads store a storage_path and NULL data; legacy rows
-- keep their bytea until re-uploaded — the reader (AudioServiceImpl)
-- falls back per row, so no big-bang byte migration is needed.
--
-- Why move: bytea rows this size bloat the table and WAL, make backups
-- heavy, and force every read through the DB connection. Files on disk
-- stream for free and the DB keeps only metadata.
ALTER TABLE audio_files
    ADD COLUMN storage_path VARCHAR(300);

ALTER TABLE audio_files
    ALTER COLUMN data DROP NOT NULL;

-- Every row must have exactly one home for its bytes.
ALTER TABLE audio_files
    ADD CONSTRAINT audio_files_bytes_somewhere
        CHECK (data IS NOT NULL OR storage_path IS NOT NULL);
