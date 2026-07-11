package com.cotune.track;

/**
 * The two things you can do to one note. That is the entire vocabulary of
 * real-time beat editing, and it is deliberately this small.
 *
 * There is no MOVE. Moving a note changes its (step, pitch) — which IS its
 * identity (Track.replacePattern rejects two events at the same step+pitch) —
 * so a move is not a mutation of one note, it is the removal of one note and
 * the addition of another. Modelling it as REMOVE + ADD means the merge rule
 * stays a single sentence and the applier stays branch-free. A first-class
 * MOVE op would need to answer "what if the note it moves was already deleted
 * by someone else?", and every answer to that question is a bug.
 *
 * There is no CLEAR_LANE either — that is a coarse edit, and coarse edits
 * still go through the GraphQL whole-pattern save.
 */
public enum NoteOpType {

    /**
     * Put a note at (step, pitch). UPSERT semantics: if one is already there,
     * its velocity/length are overwritten. That makes the op IDEMPOTENT —
     * applying it twice leaves the same lane — which is what lets the client
     * re-send an op it isn't sure landed without risking a duplicate.
     */
    ADD,

    /** Take the note at (step, pitch) away. Removing nothing is not an error,
     *  for the same idempotency reason. */
    REMOVE
}
