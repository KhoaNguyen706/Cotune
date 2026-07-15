package com.cotune.history;

/**
 * What kinds of change history records. Deliberately the same vocabulary
 * the wire already speaks: the delta path logs its two op types verbatim,
 * and the whole-grid save (HTTP fallback, restores) logs the one thing it
 * does. Structural changes (lanes/beats appearing and disappearing) are
 * visible in history as their consequences — a lane whose name no longer
 * resolves WAS deleted — without needing event types of their own yet.
 */
public enum SongEventType {

    /** One note landed (or replaced the note at its step+pitch). */
    NOTE_ADD,

    /** One note removed. */
    NOTE_REMOVE,

    /** The whole grid replaced at once: an HTTP save, a clear that rode
     *  the fallback path, the V15 baseline, or a restore being kept. */
    PATTERN_SET
}
