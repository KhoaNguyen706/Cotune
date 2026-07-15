package com.cotune.realtime;

import com.cotune.realtime.dto.NoteEvent;
import com.cotune.realtime.dto.PresenceEvent;
import com.cotune.realtime.dto.PresenceInput;
import com.cotune.realtime.relay.RealtimeBroadcaster;
import com.cotune.track.TrackService;
import com.cotune.track.dto.NoteApplied;
import com.cotune.track.dto.NoteOp;
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

    private final TrackService trackService;
    /**
     * Not a SimpMessagingTemplate any more (session 19). "Give this to the local
     * broker" and "make sure everyone on this song hears it, wherever they are
     * connected" were the same sentence while there was one instance. They are
     * not the same sentence any more, and this controller wants the second one.
     */
    private final RealtimeBroadcaster broadcaster;
    private final DisplayNames displayNames;

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

        UUID actor = UUID.fromString(authentication.getName());
        // The actor rides into the service so history (V15) can attribute
        // the delta — the same identity the broadcast already stamps.
        NoteApplied applied = trackService.applyNote(songId, op.trackId(), op, actor);

        // Broadcast to EVERYONE on the song, the sender included. Echoing to
        // the sender is deliberate: it is their acknowledgement that the op
        // landed and it carries the authoritative new version. They recognise
        // it by actorId and apply only the version, not the note (see NoteEvent).
        //
        // "Everyone" now genuinely means everyone, not just everyone who happens
        // to have been load-balanced onto this JVM.
        broadcaster.broadcast("/topic/songs/" + songId, new NoteEvent(
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
     * "I am here, my cursor is on this cell." Relayed to the rest of the room.
     *
     * canVIEW, not canEdit: a viewer is in the room too, and hiding them would
     * be a lie about who is watching. They still cannot change a note — that is
     * a different destination with a different rule.
     *
     * The server persists NOTHING here and remembers nothing. It stamps the
     * identity and forwards. Everything else — who is present, who has gone
     * quiet — is worked out by each client from the stream it receives; see
     * PresenceKind for why a server-side session registry would be both leakier
     * and wrong the moment there are two instances.
     */
    @MessageMapping("/songs/{songId}/presence")
    @PreAuthorize("@songAccess.canView(#songId, authentication)")
    public void presence(@DestinationVariable UUID songId,
                         @Payload @Valid PresenceInput input,
                         Authentication authentication) {

        broadcaster.broadcast("/topic/songs/" + songId + "/presence", new PresenceEvent(
                input.kind(),
                // Identity from the TOKEN, never from the payload. Accept a
                // client-supplied name here and anyone can paint a cursor
                // labelled "Alice" onto her collaborators' screens.
                UUID.fromString(authentication.getName()),
                displayNames.of(authentication),
                input.beatId(),
                input.trackId(),
                input.step(),
                input.row()));
    }

    // Rejected messages route back to the sender's private error queue via
    // RealtimeExceptionAdvice — moved out of this class when chat became
    // the second @MessageMapping controller that needed it.
}
