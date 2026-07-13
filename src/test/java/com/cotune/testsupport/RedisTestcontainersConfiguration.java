package com.cotune.testsupport;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * A throwaway Redis, imported ONLY by the relay test.
 *
 * Kept out of TestcontainersConfiguration on purpose. Every integration test
 * shares one Spring context precisely because they all describe the identical
 * configuration (see AbstractIntegrationTest); adding a Redis to the base config
 * would start a container that 86 tests have no use for. The relay test forks its
 * own context regardless — it must, since cotune.realtime.relay=redis IS a
 * different configuration — so the container belongs with the fork, not the base.
 *
 * @ServiceConnection(name = "redis") on a plain GenericContainer: Boot has no
 * dedicated RedisContainer type, so the NAME is what tells it which
 * ConnectionDetails factory to apply. Without the name it would see an anonymous
 * container, wire nothing, and the app would quietly connect to localhost:6379 —
 * i.e. to whatever Redis you happen to have running on your laptop. The test
 * would pass on your machine and fail in CI, which is the worst outcome
 * available.
 */
@TestConfiguration(proxyBeanMethods = false)
public class RedisTestcontainersConfiguration {

    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> redisContainer() {
        return new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
                .withExposedPorts(6379);
    }
}
