package com.cotune.realtime;

import com.cotune.realtime.dto.NoteEvent;
import com.cotune.realtime.dto.RealtimeError;
import com.cotune.track.TrackService;
import com.cotune.track.dto.NoteApplied;
import com.cotune.track.dto.NoteOp;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.util.UUID;

/**
 * The real-time editing surface. Same shape as every other controller in this
 * codebase — bind, authorize, delegate, publish — just over a different
 * transport. That similarity is the payoff of having kept the rules in
 * SongAccess and the behaviour in TrackService: adding a whole new protocol
 * needed no new authorization model and no new business logic.
 */
@Controller
@Validated
@RequiredArgsConstructor
public class RealtimeController {

    private static final Logger log = LoggerFactory.getLogger(RealtimeController.class);

    private final TrackService trackService;
    private final SimpMessagingTemplate broker;

    /**
     * A client edited one note.
     *
     * Note where the message goes and where it does NOT go: it arrives on /app
     * (routed to this method), and only THIS METHOD may publish to /topic. A
     * client cannot send to /topic directly — see WebSocketConfig — so every
     * change on the wire has necessarily been authorized, validated against the
     * domain rules, merged and persisted before anyone else hears about it. The
     * server is authoritative; clients propose, they do not broadcast.
     *
     * @PreAuthorize with canEdit, exactly as on the GraphQL mutations: a VIEWER
     * may subscribe and watch the beat change under them, and may not touch it.
     * The rule is the same object, from the same class, as the HTTP path — the
     * one thing you must never do is re-implement it here "for the socket".
     */
    @MessageMapping("/songs/{songId}/notes")
    @PreAuthorize("@songAccess.canEdit(#songId, authentication)")
    public void note(@DestinationVariable UUID songId,
                     @Payload @Valid NoteOp op,
                     Authentication authentication) {

        NoteApplied applied = trackService.applyNote(songId, op.trackId(), op);
        UUID actor = UUID.fromString(authentication.getName());

        // Broadcast to EVERYONE on the song, the sender included. Echoing to
        // the sender is deliberate: it is their acknowledgement that the op
        // landed and it carries the authoritative new version. They recognise
        // it by actorId and apply only the version, not the note (see NoteEvent).
        broker.convertAndSend("/topic/songs/" + songId, new NoteEvent(
                songId,
                applied.trackId(),
                op.type(),
                op.step(),
                op.pitch(),
                op.velocity(),
                op.length(),
                applied.version(),
                actor));
    }

    /**
     * A message that blows up has nowhere to go by default — no HTTP response
     * to put a 4xx in — so without this handler a rejected op fails SILENTLY:
     * the client's note stays on screen, the server never stored it, and the
     * two disagree until the next reload. That is the worst possible failure
     * mode for an editor, so the error is routed back to the one client that
     * caused it.
     *
     * @SendToUser targets THIS session's private queue; Spring rewrites
     * /user/** per session, so one collaborator's error never lands in
     * another's client.
     */
    @MessageExceptionHandler
    @SendToUser("/queue/errors")
    public RealtimeError onError(Exception failure) {
        log.warn("Realtime op rejected: {}", failure.toString());
        String message = failure.getMessage() == null ? "Edit rejected" : failure.getMessage();
        return new RealtimeError(message);
    }
}
