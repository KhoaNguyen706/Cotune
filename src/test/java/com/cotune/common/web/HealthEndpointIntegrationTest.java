package com.cotune.common.web;

import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.RequestEntity;
import org.springframework.http.ResponseEntity;

import java.net.URI;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The health endpoint's contract has two halves and they pull in opposite
 * directions: it must be reachable by an unauthenticated monitor, and it
 * must be the ONLY actuator endpoint reachable by anyone at all. Each test
 * takes one half. What "healthy" means (a real SELECT against the real
 * database) is Boot's code, not ours — we assert the wiring, not Boot.
 */
class HealthEndpointIntegrationTest extends AbstractIntegrationTest {

    @Test
    void healthAnswersUnauthenticatedAndChecksTheRealDatabase() {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                RequestEntity.get(URI.create("/actuator/health")).build(),
                new ParameterizedTypeReference<>() {
                });

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().get("status")).isEqualTo("UP");
        // show-details is `always` outside prod, so the db component must
        // appear — UP here means Boot really executed its validation query
        // against the Testcontainers Postgres, which is the entire point:
        // "port open" and "can reach the database" are different facts.
        @SuppressWarnings("unchecked")
        Map<String, Object> components = (Map<String, Object>) response.getBody().get("components");
        assertThat(components).containsKey("db");
        // Redis is on the classpath but not connected while the relay is
        // `local` — its indicator is disabled or health would be DOWN for
        // not using a Redis we don't need. If this starts failing after
        // enabling the relay, delete the assertion; don't re-disable redis.
        assertThat(components).doesNotContainKey("redis");
    }

    @Test
    void everyOtherActuatorEndpointStaysLocked() {
        // /env is the one that dumps configuration; if the deny-by-default
        // rule ever loosens, this is the endpoint that turns it into an
        // incident. 401, not 404: security refuses before the endpoint
        // layer could even say whether it exists.
        for (String path : new String[]{"/actuator/env", "/actuator/metrics", "/actuator"}) {
            assertThat(rest.getForEntity(path, Void.class).getStatusCode())
                    .as("%s must not be reachable anonymously", path)
                    .isEqualTo(HttpStatus.UNAUTHORIZED);
        }
    }
}
