package com.cotune.audio.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

/** The API's view of an uploaded file — metadata only, bytes ride on
 *  GET /api/audio/{id}. Serves both the REST upload response and the
 *  GraphQL AudioFile type. */
public record AudioFileDto(
        UUID id,
        UUID songId,
        String filename,
        String contentType,
        long sizeBytes,
        double durationSeconds,
        OffsetDateTime createdAt
) {
}
