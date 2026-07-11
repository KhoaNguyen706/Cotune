package com.cotune.realtime;

import com.cotune.song.SongAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The door of the WebSocket. Everything a client is allowed to do is decided
 * here or in @PreAuthorize on the handlers — there is nowhere else.
 *
 * WHY AUTH LIVES IN THE CONNECT FRAME AND NOT IN THE HTTP HANDSHAKE:
 * the browser's WebSocket constructor takes a URL and nothing else. It cannot
 * set an Authorization header. So the usual bearer-token filter has no token to
 * read at handshake time, and /ws is permitAll in SecurityConfig as a result.
 * The first thing a client does after the socket opens is send a STOMP CONNECT
 * frame, and STOMP frames carry arbitrary headers — so the token rides there.
 *
 * (The other common workaround is a `?token=...` query parameter. Avoid it:
 * URLs land in access logs, proxy logs and browser history, and you have just
 * written credentials into all three.)
 *
 * WHAT THIS MEANS FOR SAFETY: an unauthenticated socket can be OPEN. That is
 * only acceptable because such a session can do nothing — it has no user, so
 * SUBSCRIBE is refused below and SEND is refused by @PreAuthorize. An open
 * socket that could subscribe to anything would be a broadcast of every song
 * in the system to anyone who knows the URL.
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    /**
     * The only topics clients may listen to, and both are per-song: the edits
     * themselves, and (optionally) who is in the room.
     *
     * The regex is anchored and the id group is fixed-width ON PURPOSE. A
     * loose prefix match like destination.startsWith("/topic/songs/") would
     * authorize "/topic/songs/../../everything" and any other destination that
     * merely begins with the right letters — the check must parse the id it is
     * going to authorize, not squint at the string.
     */
    private static final Pattern SONG_TOPIC =
            Pattern.compile("^/topic/songs/([0-9a-fA-F-]{36})(/presence)?$");

    private final JwtDecoder jwtDecoder;
    // The SAME converter the HTTP filter chain uses (a @Bean since session 16).
    // Rebuilding it here would risk mapping the "roles" claim differently on
    // the socket than on HTTP — and authority bugs fail silently.
    private final JwtAuthenticationConverter jwtAuthenticationConverter;
    private final SongAccess songAccess;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message; // heartbeats and internal plumbing
        }

        switch (accessor.getCommand()) {
            case CONNECT -> accessor.setUser(authenticate(accessor));
            case SUBSCRIBE -> authorizeSubscription(accessor);
            default -> {
                // SEND is authorized by @PreAuthorize on the @MessageMapping,
                // where the destination has already been parsed into a songId.
                // DISCONNECT/ACK need no rule.
            }
        }
        return message;
    }

    /**
     * Turn the CONNECT frame's bearer token into an Authentication, or refuse
     * the connection. Throwing here means the client gets a STOMP ERROR frame
     * and the socket closes — the connection never becomes usable.
     */
    private Authentication authenticate(StompHeaderAccessor accessor) {
        List<String> headers = accessor.getNativeHeader("Authorization");
        if (headers == null || headers.isEmpty()) {
            throw new AccessDeniedException("WebSocket CONNECT requires a bearer token");
        }
        String header = headers.getFirst();
        if (!header.startsWith("Bearer ")) {
            throw new AccessDeniedException("Authorization header must be a bearer token");
        }

        try {
            Jwt jwt = jwtDecoder.decode(header.substring("Bearer ".length()));
            // decode() already verified the signature AND the expiry — an
            // expired token cannot open a socket that then lives for hours.
            return jwtAuthenticationConverter.convert(jwt);
        } catch (JwtException invalid) {
            // Do not echo the parser's message back to the client; it can be
            // surprisingly chatty about key material. The client only needs
            // "your token is no good".
            throw new AccessDeniedException("Invalid or expired token");
        }
    }

    /**
     * A subscription is a standing request to be sent every future change to a
     * song. It therefore needs exactly the same object-level check as reading
     * that song over HTTP — the same canView, from the same SongAccess.
     *
     * This is the check that would be easiest to forget, and forgetting it is
     * catastrophic in a way a missing REST rule is not: a REST hole leaks data
     * when someone asks for it, whereas an unguarded topic PUSHES other
     * people's work to a listener forever, unprompted.
     */
    private void authorizeSubscription(StompHeaderAccessor accessor) {
        Principal principal = accessor.getUser();
        if (!(principal instanceof Authentication authentication)) {
            throw new AccessDeniedException("Subscribe before authenticating");
        }

        String destination = accessor.getDestination();
        if (destination == null) {
            throw new AccessDeniedException("SUBSCRIBE needs a destination");
        }

        // The private error queue: any authenticated user may listen to their
        // own. Spring rewrites /user/** per session, so one user cannot listen
        // to another's.
        if (destination.startsWith("/user/")) {
            return;
        }

        Matcher songTopic = SONG_TOPIC.matcher(destination);
        if (!songTopic.matches()) {
            // Deny by default. A destination nobody wrote a rule for is not a
            // destination anyone gets to listen to.
            throw new AccessDeniedException("Unknown destination: " + destination);
        }

        UUID songId = UUID.fromString(songTopic.group(1));
        if (!songAccess.canView(songId, authentication)) {
            throw new AccessDeniedException("You do not have access to this song");
        }
    }
}
