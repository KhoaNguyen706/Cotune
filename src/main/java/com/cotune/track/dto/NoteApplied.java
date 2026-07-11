package com.cotune.track.dto;

import java.util.UUID;

/**
 * What the server did with a note op: the lane it touched and that lane's new
 * version.
 *
 * The version rides back out to every client in the broadcast. It is not used
 * for conflict detection on this path — the applier merges rather than
 * refusing — but it keeps each client's idea of the lane's version fresh, so
 * the GraphQL whole-pattern save (which DOES use expectedVersion) still works
 * the moment the socket drops and the editor falls back to it.
 */
public record NoteApplied(UUID trackId, long version) {
}
