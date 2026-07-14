package com.cotune.chat;

import com.cotune.chat.dto.ChatMessageDto;

import java.util.List;
import java.util.UUID;

public interface ChatService {

    /**
     * Persist one line. Identity (id + display name) is the CALLER's claim
     * to make — the controller reads both from the authenticated token,
     * never from the payload.
     */
    ChatMessageDto post(UUID songId, UUID authorId, String authorName, String body);

    /** The latest messages for a song, oldest first (reading order). */
    List<ChatMessageDto> recent(UUID songId);
}
