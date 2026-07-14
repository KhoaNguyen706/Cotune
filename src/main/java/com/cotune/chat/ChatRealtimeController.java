package com.cotune.chat;

import com.cotune.chat.dto.ChatMessageDto;
import com.cotune.chat.dto.ChatPost;
import com.cotune.realtime.DisplayNames;
import com.cotune.realtime.dto.ChatEvent;
import com.cotune.realtime.relay.RealtimeBroadcaster;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.util.UUID;

/**
 * Chat rides the note-op pipeline unchanged: arrive on /app (only this
 * method may publish to /topic — clients propose, they do not broadcast),
 * authorize, persist, THEN relay. Because the broadcast goes through
 * RealtimeBroadcaster, a message posted on one instance reaches
 * collaborators connected to another the day the Redis relay turns on —
 * chat inherited multi-instance correctness without ever knowing about it.
 *
 * canVIEW, not canEdit, and that is the point of chat: the viewer who
 * cannot touch the grid is exactly the person whose "the hats feel late"
 * needs a way in. Talking about the music is not editing the music.
 *
 * Rejected posts route to the sender's /user/queue/errors via
 * RealtimeExceptionAdvice, like any other refused realtime op.
 */
@Controller
@Validated
@RequiredArgsConstructor
public class ChatRealtimeController {

    private final ChatService chatService;
    private final RealtimeBroadcaster broadcaster;
    private final DisplayNames displayNames;
    private final ChatAiBridge aiBridge;

    @MessageMapping("/songs/{songId}/chat")
    @PreAuthorize("@songAccess.canView(#songId, authentication)")
    public void chat(@DestinationVariable UUID songId,
                     @Payload @Valid ChatPost post,
                     Authentication authentication) {

        // Identity from the TOKEN, never the payload — same rule as
        // presence: accept a client-supplied name and anyone can put words
        // in Alice's mouth.
        ChatMessageDto saved = chatService.post(
                songId,
                UUID.fromString(authentication.getName()),
                displayNames.of(authentication),
                post.body());

        // Echoed to the sender too: the echo carries the server-assigned id
        // and timestamp, and its arrival is the proof the line was stored.
        broadcaster.broadcast("/topic/songs/" + songId + "/chat", ChatEvent.of(saved));

        // AFTER the human message is safely out: an @ai mention also asks
        // the advisor, whose answer arrives later as its own chat message.
        aiBridge.maybeHandle(songId, saved);
    }
}
