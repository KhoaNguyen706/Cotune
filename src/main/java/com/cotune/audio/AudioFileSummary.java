package com.cotune.audio;

import java.time.Instant;
import java.util.UUID;

/**
 * Everything about an audio file EXCEPT its bytes — the shape the
 * repository projection produces (JPQL constructor expressions can't call
 * Timestamps.utc, so this carries the raw Instant; the mapper converts).
 */
public record AudioFileSummary(
        UUID id,
        UUID songId,
        String filename,
        String contentType,
        long sizeBytes,
        double durationSeconds,
        Instant createdAt
) {
}
