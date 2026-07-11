package com.cotune.collab;

/**
 * What an invited person may do on someone else's song.
 *
 * There is no OWNER constant here, and that omission is the point: ownership
 * is not a membership row (see V10). This enum is the set of rights that can
 * be GRANTED — and you cannot grant away being the creator.
 *
 * Persisted with @Enumerated(STRING), so the constant NAMES are part of the
 * database contract; renaming one is a migration, not a refactor.
 */
public enum CollaboratorRole {

    /** May open, listen, and export — but every mutation is refused. */
    VIEWER,

    /** May change the music (beats, patterns, clips, audio) — but may not
     *  delete the song, nor invite anyone else. Those stay owner rights. */
    EDITOR
}
