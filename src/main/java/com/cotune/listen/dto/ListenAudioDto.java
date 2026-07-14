package com.cotune.listen.dto;

import java.util.UUID;

/**
 * Audio metadata for the player: the id addresses the public bytes route,
 * the duration sizes the progress bar. Deliberately NO filename — uploads
 * keep whatever name the file had on someone's disk, and "final_v2 (Dad's
 * vocals).mp3" is not something a share link should publish.
 */
public record ListenAudioDto(
        UUID id,
        String contentType,
        double durationSeconds
) {
}
