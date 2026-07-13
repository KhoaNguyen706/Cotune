package com.cotune.realtime.relay;

import com.cotune.realtime.dto.RealtimeEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * One instance: hand the event straight to the in-memory broker, which fans it
 * out to every subscriber connected to THIS JVM. Since every subscriber that
 * exists is connected to this JVM, that is everyone. Done.
 *
 * This is the behaviour the app has had since session 16, now merely named. It
 * remains the DEFAULT (matchIfMissing = true) and that is deliberate: running a
 * Redis to talk to yourself is pure operational cost, and `docker compose up`
 * for a new contributor should not require it. You pay for the relay only when
 * you actually run more than one instance.
 */
@Component
@ConditionalOnProperty(name = "cotune.realtime.relay", havingValue = "local", matchIfMissing = true)
@RequiredArgsConstructor
public class LocalBroadcaster implements RealtimeBroadcaster {

    private final SimpMessagingTemplate broker;

    @Override
    public void broadcast(String destination, RealtimeEvent event) {
        broker.convertAndSend(destination, event);
    }
}
