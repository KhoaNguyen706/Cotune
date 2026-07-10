package com.cotune.audio;

import com.cotune.audio.dto.AudioFileDto;
import com.cotune.common.mapping.Timestamps;
import org.springframework.stereotype.Component;

@Component
public class AudioMapper {

    public AudioFileDto toDto(AudioFile file) {
        return new AudioFileDto(
                file.getId(),
                file.getSong().getId(),
                file.getFilename(),
                file.getContentType(),
                file.getSizeBytes(),
                file.getDurationSeconds(),
                Timestamps.utc(file.getCreatedAt())
        );
    }

    public AudioFileDto toDto(AudioFileSummary summary) {
        return new AudioFileDto(
                summary.id(),
                summary.songId(),
                summary.filename(),
                summary.contentType(),
                summary.sizeBytes(),
                summary.durationSeconds(),
                Timestamps.utc(summary.createdAt())
        );
    }
}
