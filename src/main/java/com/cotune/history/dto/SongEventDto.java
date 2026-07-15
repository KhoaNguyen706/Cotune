package com.cotune.history.dto;

import com.cotune.history.SongEventType;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One history line, ready to render: ids resolved to names server-side
 * because the client can't join, and the names' ABSENCE is information
 * ("a deleted lane", "before history began") the server alone can state.
 */
public record SongEventDto(
        String id,
        UUID trackId,
        /** Null = the lane no longer exists — restorable is exactly
         *  "trackName != null". */
        String trackName,
        /** Null = nobody: the V15 baseline snapshot. */
        String actorName,
        SongEventType type,
        /** A human line: "added C2 at step 4". Built server-side so every
         *  client tells the story the same way. */
        String summary,
        OffsetDateTime createdAt
) {
}
