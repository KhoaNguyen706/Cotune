package com.cotune.chat;

import com.cotune.chat.dto.ChatMessageDto;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.UUID;

/**
 * History rides GraphQL, live messages ride the socket — the same split the
 * notes use (load the pattern over HTTP, hear edits over STOMP). A client
 * opens the panel, queries the recent page, then appends events; the seam
 * between "loaded" and "live" is the message id, which both sides carry.
 */
@Controller
@RequiredArgsConstructor
public class ChatGraphqlController {

    private final ChatService chatService;

    // Same rule object as the socket path (@songAccess) — the one thing you
    // must never do is re-implement the access rule per transport.
    @QueryMapping
    @PreAuthorize("@songAccess.canView(#songId, authentication)")
    public List<ChatMessageDto> chatMessages(@Argument UUID songId) {
        return chatService.recent(songId);
    }
}
