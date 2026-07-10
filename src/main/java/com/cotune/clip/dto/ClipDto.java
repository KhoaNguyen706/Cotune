package com.cotune.clip.dto;

import com.cotune.clip.ClipType;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ClipDto(
        UUID id,
        UUID songId,
        int lane,
        int startStep,
        int lengthSteps,
        ClipType type,
        UUID beatId,    // set when type == BEAT
        UUID audioId,   // set when type == AUDIO
        long version,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
