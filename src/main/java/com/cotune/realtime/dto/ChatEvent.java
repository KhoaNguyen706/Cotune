package com.cotune.realtime.dto;

import com.cotune.chat.dto.ChatMessageDto;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One chat line, as broadcast to everyone in the song's room. It is the
 * message the server PERSISTED, echoed back — same authority rule as
 * NoteEvent: nobody is ever told about a message that didn't reach the
 * database. The sender recognises their own echo by id and swaps their
 * optimistic local copy for it.
 *
 * Field-for-field twin of ChatMessageDto rather than a wrapper around it,
 * because this record must live HERE: RealtimeEvent is sealed, and on the
 * classpath a permitted subtype must share the interface's package. The
 * factory keeps the duplication one line wide.
 */
public record ChatEvent(
        UUID id,
        UUID songId,
        UUID authorId,
        String authorName,
        String body,
        OffsetDateTime createdAt
) implements RealtimeEvent {

    public static ChatEvent of(ChatMessageDto message) {
        return new ChatEvent(
                message.id(),
                message.songId(),
                message.authorId(),
                message.authorName(),
                message.body(),
                message.createdAt());
    }
}
