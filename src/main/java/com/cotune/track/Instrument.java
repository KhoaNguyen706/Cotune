package com.cotune.track;

/**
 * Maps 1:1 (by name) to `enum Instrument` in schema.graphqls — Spring binds
 * GraphQL enum values to Java enum constants automatically, but only if the
 * names match exactly. Values mirror what the Tone.js frontend can render.
 *
 * Stored in Postgres as VARCHAR via @Enumerated(STRING), never ORDINAL:
 * ordinal persists the constant's POSITION, so inserting "ORGAN" between
 * PIANO and DRUMS would silently re-label every existing row.
 */
public enum Instrument {
    SYNTH,
    PIANO,
    DRUMS,
    BASS,
    GUITAR,
    STRINGS
}
