package com.cotune.track.dto;

import com.cotune.track.Instrument;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record TrackDto(
        UUID id,
        UUID beatId,
        String name,
        Instrument instrument,
        int position,
        List<StepDto> pattern,
        // The lane's mix (V14): linear gain 0..1 and stereo pan -1..1.
        double volume,
        double pan,
        long version,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
