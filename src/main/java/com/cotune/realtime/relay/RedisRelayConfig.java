package com.cotune.realtime.relay;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

/**
 * Wires RelaySubscriber onto the Redis channel. Only exists when the relay is on.
 *
 * WHY A CONTAINER AND NOT JUST "subscribe()": Redis pub/sub is BLOCKING — a
 * connection in subscribe mode can do nothing else until it unsubscribes. So the
 * listener needs its own connection and its own thread, forever, plus reconnect
 * logic for when Redis restarts underneath it. RedisMessageListenerContainer is
 * that: a dedicated subscriber connection, a dispatch thread pool, and automatic
 * re-subscription after a connection drop. Rolling it by hand means rolling the
 * reconnect, and the failure mode of getting THAT wrong is a node that silently
 * stops receiving other people's edits while continuing to serve traffic.
 */
@Configuration
@ConditionalOnProperty(name = "cotune.realtime.relay", havingValue = "redis")
public class RedisRelayConfig {

    @Bean
    RedisMessageListenerContainer relayListenerContainer(
            RedisConnectionFactory connectionFactory,
            RelaySubscriber subscriber,
            @Value("${cotune.realtime.channel}") String channel) {

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);

        // ChannelTopic, not PatternTopic: an exact channel name. Pattern
        // subscriptions (channel*) are matched by Redis against every publish and
        // are measurably slower — and we have nothing to pattern-match, because
        // there is exactly one channel. If the channel is ever sharded by song id,
        // THIS is the line that becomes a PatternTopic.
        container.addMessageListener(subscriber, new ChannelTopic(channel));
        return container;
    }
}
