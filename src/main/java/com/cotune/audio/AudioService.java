package com.cotune.audio;

import com.cotune.audio.dto.AudioFileDto;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface AudioService {

    AudioFileDto upload(UUID songId, String filename, String contentType,
                        double durationSeconds, byte[] data);

    /** Full entity WITH bytes — download endpoint only. */
    AudioFile download(UUID id);

    void delete(UUID id);

    /** Batch contract for the Song.audioFiles GraphQL resolver. */
    Map<UUID, List<AudioFileDto>> getBySongIds(List<UUID> songIds);
}
