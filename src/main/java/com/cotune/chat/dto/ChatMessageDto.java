package com.cotune.chat.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One chat line as the API serves it — over GraphQL (history) and inside
 * ChatEvent (live). authorId is nullable: it outlives deleted accounts as
 * null while authorName keeps the transcript readable (see V11).
 *
 * NOT the same record as realtime.dto.ChatEvent even though the fields
 * match: RealtimeEvent is sealed, and sealed permits-across-packages is a
 * modules-only feature — the event must live beside the interface. The
 * mapper builds this; the realtime controller wraps it.
 */
public record ChatMessageDto(
        UUID id,
        UUID songId,
        UUID authorId,
        String authorName,
        String body,
        OffsetDateTime createdAt
) {
}
