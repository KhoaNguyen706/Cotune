package com.cotune.realtime.dto;

import com.cotune.track.NoteOpType;

import java.util.UUID;

/**
 * What every client subscribed to a song receives after somebody edits a note.
 *
 * It is the op that was APPLIED, not the op that was requested — the server
 * echoes its own decision, so a client can never be told about a change that
 * didn't actually make it to the database.
 *
 * `actorId` is not garnish. The sender receives this broadcast too, and it must
 * be able to recognise its own echo: it already drew that note locally, and
 * re-applying the echo would undo any edit it has made in the meantime (add a
 * note, drag it one step right, then have your own stale ADD arrive and put a
 * second note back where the first one used to be). The client applies other
 * people's ops to the grid and only its own op's VERSION.
 */
public record NoteEvent(
        UUID songId,
        UUID trackId,
        NoteOpType type,
        int step,
        String pitch,
        double velocity,
        int length,
        /** The lane's version after this op — keeps the HTTP save path's
         *  optimistic-concurrency check honest if the socket later drops. */
        long version,
        UUID actorId
) implements RealtimeEvent {
}
