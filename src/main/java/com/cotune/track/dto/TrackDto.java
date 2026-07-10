package com.cotune.track.dto;

import com.cotune.track.Instrument;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record TrackDto(
        UUID id,
        UUID songId,
        String name,
        Instrument instrument,
        int position,
        List<StepDto> pattern,
        long version,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
