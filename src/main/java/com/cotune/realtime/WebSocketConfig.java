package com.cotune.realtime;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
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
 * The broker here is the SIMPLE broker: an in-memory table of subscriptions
 * living inside this JVM. It fans a message out to the clients connected to
 * THIS instance, which is everyone — right up until you run a second instance,
 * at which point a note sent to A never reaches a subscriber on B.
 *
 * SESSION 19 FIXED THAT, AND NOT HERE. This comment used to promise that the
 * seam was this very method — swap enableSimpleBroker() for a broker relay and
 * point it at Redis. That is wrong, and it is a productive kind of wrong:
 * enableStompBrokerRelay() needs a broker that SPEAKS STOMP (RabbitMQ,
 * ActiveMQ). Redis does not. It has PUBLISH and a channel name; it has no
 * destinations, no SUBSCRIBE frames, no acks. There is nothing to plug in here.
 *
 * The simple broker was never the broken part — fanning out to local
 * subscribers is exactly what it is good at. What was missing is that a JVM
 * only knows its own subscribers, and that gap closes ONE LEVEL UP, in front of
 * the broker rather than underneath it: see RealtimeBroadcaster. This method is
 * unchanged, and correct, at any number of instances.
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
        registry.enableSimpleBroker("/topic", "/queue")
                // HEARTBEATS, and they are not a nicety — they are what keeps the
                // socket ALIVE in front of a real proxy. Heroku's router (and most
                // load balancers, and plenty of corporate proxies) silently close
                // any connection that has carried no bytes for 55 seconds. A
                // WebSocket that nobody is typing into carries no bytes.
                //
                // The failure this prevents is nasty precisely because it looks
                // random: the app works, you leave a tab open for a minute, and the
                // "live" badge quietly drops — but only in production, and only for
                // idle users, so it never reproduces on a laptop. Note that presence
                // heartbeats (session 17) hide this on the EDITOR page by accident,
                // since a cursor frame every 3s is traffic. Everywhere else — a song
                // open with nobody moving, the library page — the socket is idle and
                // dies. Fixing it at the transport, not by relying on the feature
                // that happens to chatter, is the difference.
                //
                // {25s, 25s}: server writes within 25s, expects a client beat within
                // 25s. Comfortably inside 55s, and cheap — a heartbeat is one byte.
                .setHeartbeatValue(new long[]{25_000, 25_000})
                // The simple broker will NOT send heartbeats without a scheduler, and
                // it does not fall back to a default one: omit this and setHeartbeatValue
                // above is silently a no-op. (It throws on startup in current Spring —
                // it used to just not beat, which was worse.)
                .setTaskScheduler(heartbeatScheduler());

        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    /**
     * A dedicated one-thread scheduler for broker heartbeats. It is deliberately
     * NOT the app's general-purpose scheduler: a heartbeat that is late because
     * some unrelated @Scheduled job is hogging the pool is a heartbeat that
     * misses its window, and the proxy hangs up on a connection that was perfectly
     * healthy.
     */
    @Bean
    public TaskScheduler heartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("ws-heartbeat-");
        scheduler.initialize();
        return scheduler;
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
