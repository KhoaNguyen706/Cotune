package com.cotune.realtime.dto;

import com.cotune.realtime.PresenceKind;

import java.util.UUID;

/**
 * Where somebody is, as everyone else is told about it.
 *
 * Identical to PresenceInput except for the two fields that matter most —
 * userId and displayName — which the SERVER adds from the authenticated
 * session. That asymmetry is the entire security model of presence: the client
 * says where it is, the server says who it is.
 */
public record PresenceEvent(
        PresenceKind kind,
        UUID userId,
        String displayName,
        UUID beatId,
        UUID trackId,
        int step,
        int row
) {
}
