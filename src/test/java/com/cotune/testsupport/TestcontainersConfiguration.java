package com.cotune.testsupport;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * One throwaway Postgres for the whole integration suite.
 *
 * The image tag matches docker-compose.yml on purpose: the value of an
 * integration test is fidelity, and "postgres:16-alpine here, postgres:17
 * there" quietly reintroduces the environment drift these tests exist to
 * catch (JSONB behavior, collations, reserved words all vary by version).
 *
 * @ServiceConnection is the modern replacement for the classic
 * @DynamicPropertySource triple (url/username/password): Boot inspects the
 * container type, sees "this is a JDBC service", and wires the DataSource
 * to wherever the container actually bound — including its RANDOM host
 * port, which a static application-test.yml could never know.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    @Bean
    @ServiceConnection
    PostgreSQLContainer<?> postgresContainer() {
        return new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"));
    }
}
