package com.cotune.listen.dto;

import java.util.List;
import java.util.UUID;

/**
 * Beat and track ids DO ride along — clips reference beats by id, so the
 * player needs them to resolve placements. They authorize nothing (every
 * mutation checks rights against the SONG), so exposing them costs only
 * what the ids themselves say, which is nothing.
 */
public record ListenBeatDto(
        UUID id,
        String name,
        int position,
        int bars,
        List<ListenTrackDto> tracks
) {
}
