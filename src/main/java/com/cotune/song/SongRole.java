package com.cotune.song;

/**
 * The CALLER's effective permission on one song — the answer to "what am I
 * allowed to do here?", computed server-side by SongAccess.
 *
 * Why this exists as its own enum instead of reusing CollaboratorRole:
 * CollaboratorRole is what you can be GRANTED (EDITOR/VIEWER); SongRole is
 * what you effectively ARE, which includes OWNER — a state nobody can be
 * granted into. Two different questions, two different types; merging them
 * would let `shareSong(role: OWNER)` typecheck, and the schema would stop
 * making the illegal state unrepresentable.
 *
 * The frontend reads this off the Song rather than re-deriving it from
 * ownerId. That is a direct fix for the Session 14 bug: the UI had its own
 * copy of the edit rule, the copy drifted from the server's, and users got
 * buttons that always 403'd. The rule now has exactly one implementation
 * and the client is told the outcome.
 */
public enum SongRole {

    /** Created it. May edit, share, and delete. */
    OWNER,

    /** Invited with write access. May edit; may not share or delete. */
    EDITOR,

    /** Invited read-only — and also the answer for legacy ownerless songs,
     *  which nobody may edit (see SongAccess). */
    VIEWER
}
