package com.cotune.beat;

import com.cotune.beat.dto.BeatDto;
import com.cotune.common.mapping.Timestamps;
import org.springframework.stereotype.Component;

@Component
public class BeatMapper {

    public BeatDto toDto(Beat beat) {
        return new BeatDto(
                beat.getId(),
                beat.getSong().getId(),
                beat.getName(),
                beat.getPosition(),
                beat.getVersion(),
                Timestamps.utc(beat.getCreatedAt()),
                Timestamps.utc(beat.getUpdatedAt())
        );
    }
}
