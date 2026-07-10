package com.cotune.beat.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record BeatDto(
        UUID id,
        UUID songId,
        String name,
        int position,
        long version,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
