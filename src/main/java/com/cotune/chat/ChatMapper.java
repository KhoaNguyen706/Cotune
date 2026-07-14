package com.cotune.chat;

import com.cotune.chat.dto.ChatMessageDto;
import com.cotune.common.mapping.Timestamps;
import org.springframework.stereotype.Component;

/** Entity → DTO, hand-written like every other mapper here (see SongMapper). */
@Component
public class ChatMapper {

    public ChatMessageDto toDto(ChatMessage message) {
        return new ChatMessageDto(
                message.getId(),
                message.getSong().getId(),
                message.getAuthorId(),
                message.getAuthorName(),
                message.getBody(),
                Timestamps.utc(message.getCreatedAt())
        );
    }
}
