package com.cotune.clip;

import com.cotune.clip.dto.ClipDto;
import com.cotune.common.mapping.Timestamps;
import org.springframework.stereotype.Component;

@Component
public class ClipMapper {

    public ClipDto toDto(Clip clip) {
        return new ClipDto(
                clip.getId(),
                // Ids off lazy proxies are free — served from the FK value,
                // no SQL (same note as TrackMapper).
                clip.getSong().getId(),
                clip.getLane(),
                clip.getStartStep(),
                clip.getLengthSteps(),
                clip.getType(),
                clip.getBeat() == null ? null : clip.getBeat().getId(),
                clip.getAudioFile() == null ? null : clip.getAudioFile().getId(),
                clip.getVersion(),
                Timestamps.utc(clip.getCreatedAt()),
                Timestamps.utc(clip.getUpdatedAt())
        );
    }
}
