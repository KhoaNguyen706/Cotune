package com.cotune.realtime;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.security.messaging.context.SecurityContextChannelInterceptor;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * The real-time pipe (session 16).
 *
 * WHY STOMP AND NOT A RAW WEBSOCKET: a raw socket gives you a byte stream and
 * nothing else — no addressing, no fan-out, no "who is listening to what". You
 * would end up hand-rolling a message router, a subscription registry and an
 * envelope format, i.e. re-inventing STOMP, badly, inside the app. STOMP is
 * that grammar: destinations, SUBSCRIBE, SEND. Spring then hands us
 * @MessageMapping (the same programming model as @PostMapping) instead of one
 * giant onMessage(String) switch.
 *
 * THE THREE PREFIXES, and why they are not interchangeable:
 *
 *   /app   — client → server. Messages here are ROUTED TO OUR CODE
 *            (@MessageMapping). Nothing a client sends is ever echoed
 *            automatically; the server decides what, if anything, to publish.
 *   /topic — server → many clients. The broker fans these out. Clients may
 *            only SUBSCRIBE here; they cannot SEND, which is the whole point:
 *            if clients could publish straight to /topic they would broadcast
 *            unvalidated, unauthorized, unpersisted messages to every listener
 *            on the song. Every change must go through /app first so it can be
 *            checked, applied and persisted.
 *   /user  — server → ONE client (errors meant for the sender alone).
 *
 * The broker here is the SIMPLE broker: an in-memory table of subscriptions,
 * living inside this JVM. It is correct and fast for one instance, and it is
 * exactly what breaks when you run two: a note sent to instance A never
 * reaches a subscriber connected to instance B. Fixing that is what Redis
 * pub/sub is for, and it is the next session — the seam is right here, in this
 * one method.
 */
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // No withSockJS(): SockJS exists to emulate WebSockets on browsers that
        // lack them, and every browser this app supports has had them for a
        // decade. It would cost an extra HTTP round trip and a fallback code
        // path we could never realistically test.
        registry.addEndpoint("/ws").setAllowedOriginPatterns("*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    /**
     * ORDER IS LOAD-BEARING. The auth interceptor runs first and attaches the
     * authenticated user to the STOMP session; SecurityContextChannelInterceptor
     * then copies that user into the SecurityContextHolder of the thread that
     * will run the handler, which is what @PreAuthorize reads.
     *
     * Swap them and @PreAuthorize sees an empty context on the very first
     * message and denies it — a failure that looks like "my rules are too
     * strict" rather than "my interceptors are in the wrong order".
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor, new SecurityContextChannelInterceptor());
    }
}
