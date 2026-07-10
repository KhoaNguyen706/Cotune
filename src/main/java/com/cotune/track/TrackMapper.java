package com.cotune.track;

import com.cotune.common.mapping.Timestamps;
import com.cotune.track.dto.StepDto;
import com.cotune.track.dto.TrackDto;
import org.springframework.stereotype.Component;

/**
 * Only entity → DTO here. There is no toEntity(AddTrackInput): building a
 * Track needs a Song reference and a server-assigned position — decisions
 * that belong to the service, not to a dumb translation layer. A mapper
 * that loads entities and computes positions isn't a mapper anymore.
 */
@Component
public class TrackMapper {

    public TrackDto toDto(Track track) {
        return new TrackDto(
                track.getId(),
                // Safe even when `song` is an uninitialized lazy proxy:
                // Hibernate serves the id straight from the proxy (it was
                // created FROM the FK value) — no SQL fires for this call.
                track.getSong().getId(),
                track.getName(),
                track.getInstrument(),
                track.getPosition(),
                track.getPattern().stream()
                        .map(step -> new StepDto(step.step(), step.pitch(), step.velocity()))
                        .toList(),
                track.getVersion(),
                Timestamps.utc(track.getCreatedAt()),
                Timestamps.utc(track.getUpdatedAt())
        );
    }
}
