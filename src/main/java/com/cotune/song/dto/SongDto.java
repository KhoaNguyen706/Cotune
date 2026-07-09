package com.cotune.song.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * What the API returns for a Song. A record: immutable, value-based
 * equality, no ceremony — exactly the semantics a DTO should have.
 *
 * We never expose the JPA entity itself through the API. The entity's shape
 * is coupled to the database; the DTO's shape is coupled to the GraphQL
 * schema. Keeping them separate lets either evolve without breaking the
 * other (and avoids lazy-loading surprises during serialization).
 */
public record SongDto(
        UUID id,
        String title,
        int bpm,
        String timeSignature,
        long version,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
