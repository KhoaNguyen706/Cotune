package com.cotune.listen.dto;

import com.cotune.track.Instrument;
import com.cotune.track.dto.StepDto;

import java.util.List;
import java.util.UUID;

public record ListenTrackDto(
        UUID id,
        String name,
        Instrument instrument,
        int position,
        List<StepDto> pattern
) {
}
