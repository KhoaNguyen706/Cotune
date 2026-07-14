package com.cotune.chat.dto;

import com.cotune.chat.ChatMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * What a client SENDS — just the words. Note what is absent: author id,
 * author name, timestamp, song id. Identity comes from the token and the
 * song from the destination, exactly like PresenceInput — accept a name in
 * the payload and anyone can put words in Alice's mouth.
 */
public record ChatPost(
        @NotBlank
        @Size(max = ChatMessage.MAX_BODY_LENGTH)
        String body
) {
}
