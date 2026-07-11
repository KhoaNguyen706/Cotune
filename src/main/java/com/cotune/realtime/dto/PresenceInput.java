package com.cotune.realtime.dto;

import com.cotune.realtime.PresenceKind;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * What a client SAYS about where it is.
 *
 * Look at what this record does not contain: userId and displayName. A client
 * does not get to tell the server who it is — the server takes that from the
 * verified token and stamps it on the way out (see RealtimeController). If
 * identity travelled in the body, anyone could paint a cursor labelled "Alice"
 * onto her collaborators' screens, which is impersonation with a friendly face.
 *
 * Same mass-assignment rule that keeps ownerId out of CreateSongInput and role
 * out of RegisterInput. It keeps showing up because it is the rule: never accept
 * from the client a fact the server already knows.
 */
public record PresenceInput(
        @NotNull PresenceKind kind,
        /** Which beat's grid they are looking at (null while arranging). */
        UUID beatId,
        /** Which lane. Cursors only render for peers on the same lane. */
        UUID trackId,
        /** Cell coordinates in the piano roll: step across, pitch-row down. */
        int step,
        int row
) {
}
