package com.cotune.realtime.relay;

import com.cotune.realtime.dto.RealtimeEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * The other half of the relay: everything published to the channel — by any
 * instance, INCLUDING THIS ONE — comes back here, and gets handed to the local
 * in-memory broker for fan-out to whoever is connected to this JVM.
 *
 * This is the ONLY place in the application that delivers a broadcast to a
 * browser when the relay is on. That is the invariant RedisBroadcaster's comment
 * is protecting, and it is what makes "did the message get delivered twice?" a
 * question you can answer by reading one class.
 *
 * NOTE WHAT IS ABSENT: any filtering by song. Every instance receives every
 * message for every song in the system, then hands it to a broker that finds no
 * local subscribers and drops it. That sounds wasteful and IS wasteful, and it
 * is still the right call today: the alternative is subscribing to a Redis
 * channel per song, which means tracking which songs have a live client on this
 * instance, subscribing and unsubscribing as people come and go — i.e. exactly
 * the mutable server-side session registry that session 17 refused to build,
 * with the same leak (a laptop lid closes; who unsubscribes?). Fan-out-to-all is
 * stateless and self-healing. It stops being right somewhere north of "every
 * instance's NIC is saturated by songs it isn't hosting", and the fix then is to
 * shard the channel by song id — a change confined to two lines, here and in
 * RedisBroadcaster.
 */
@Component
@ConditionalOnProperty(name = "cotune.realtime.relay", havingValue = "redis")
@RequiredArgsConstructor
public class RelaySubscriber implements MessageListener {

    private static final Logger log = LoggerFactory.getLogger(RelaySubscriber.class);

    private final SimpMessagingTemplate broker;
    private final ObjectMapper json;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            RelayEnvelope envelope = json.readValue(message.getBody(), RelayEnvelope.class);
            RealtimeEvent event = envelope.decode(json);

            // The destination rode along in the envelope precisely so this line
            // could exist: Redis knows nothing about STOMP topics.
            broker.convertAndSend(envelope.destination(), event);

        } catch (Exception e) {
            // A poison message must NOT kill the listener. This runs on the Redis
            // listener container's thread, which is shared by every song on this
            // instance — let an exception escape and the container logs it and,
            // depending on version and error, can stop dispatching. One malformed
            // envelope would then silently sever real-time for every user on this
            // JVM, and the app would look perfectly healthy. Drop the message,
            // keep the pipe.
            log.error("Unreadable relay envelope, dropped: {}", new String(message.getBody()), e);
        }
    }
}
