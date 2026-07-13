package com.cotune.realtime.relay;

import com.cotune.realtime.dto.RealtimeEvent;

/**
 * "Send this to everyone in this room, wherever they happen to be connected."
 *
 * THIS is the seam for horizontal scale — and it is worth being precise about
 * why it is HERE and not where session 16 predicted it would be.
 *
 * Session 16 left a note saying the seam was WebSocketConfig.configureMessageBroker,
 * i.e. swap enableSimpleBroker() for a broker relay. That is wrong, and it is a
 * mistake worth having made once: enableStompBrokerRelay() requires a broker that
 * SPEAKS STOMP — RabbitMQ, ActiveMQ, HornetQ. Redis does not speak STOMP. It has
 * no destinations, no SUBSCRIBE frames, no acks; it has PUBLISH and a channel
 * name. You cannot plug it in there, and an afternoon spent trying is how most
 * people learn that "message broker" is not one interface.
 *
 * So the simple broker STAYS. It was never the broken part: fanning a message out
 * to the subscribers connected to THIS JVM is exactly what it does well. The part
 * that was broken is that a JVM only knows about its own subscribers. That gap
 * closes one level up — in front of the broker, not underneath it — by making the
 * act of broadcasting an abstraction with two implementations:
 *
 *   LocalBroadcaster  — hand it straight to the in-memory broker. One instance.
 *   RedisBroadcaster  — PUBLISH it, and let every instance (including this one)
 *                       hand its own copy to its own in-memory broker.
 *
 * The controller does not know which one it has, which is the point: RealtimeController
 * is unchanged in behaviour whether you run one instance or ten, and the decision
 * is a config property rather than a code path.
 */
public interface RealtimeBroadcaster {

    /**
     * @param destination a STOMP topic, e.g. /topic/songs/{id}
     * @param event       what everyone subscribed to it should be told
     */
    void broadcast(String destination, RealtimeEvent event);
}
