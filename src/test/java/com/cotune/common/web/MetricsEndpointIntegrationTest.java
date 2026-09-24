package com.cotune.common.web;

import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.RequestEntity;
import org.springframework.http.ResponseEntity;

import java.net.URI;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * /actuator/prometheus is the second endpoint ever exposed under /actuator,
 * and it is exposed on the OPPOSITE terms to the first one: health is public
 * and says almost nothing, metrics say a great deal and are ADMIN-only.
 *
 * That asymmetry is the thing worth testing. The failure mode this class
 * exists to catch is not "metrics stopped working" — that is loud and someone
 * notices within a day. It is metrics becoming READABLE BY ANYONE, which is
 * completely silent: the endpoint returns 200 either way, and the only
 * difference is who was asking. Nobody files a bug for a page that loads.
 *
 * Three requests, three identities, because "is it protected" is not one
 * question: anonymous and authenticated-but-ordinary fail for different
 * reasons in Spring Security, and a rule that confuses them (permitAll where
 * hasRole was meant) passes a test that only ever checks the anonymous case.
 */
class MetricsEndpointIntegrationTest extends AbstractIntegrationTest {

    private static final String PATH = "/actuator/prometheus";

    @Test
    void anonymousCannotScrapeMetrics() {
        // 401 and not 403: no credential was presented at all, so Spring's
        // entry point asks "who are you?" before any role is considered —
        // the same distinction the /admin deep-link bug turned on.
        assertThat(rest.getForEntity(PATH, Void.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void anOrdinaryLoggedInUserCannotScrapeMetrics() {
        // 403 this time: identity established, role insufficient. This is the
        // case that catches a rule downgraded from hasRole('ADMIN') to
        // .authenticated() — which would still pass the anonymous test above
        // while handing every registered account the app's internals.
        String token = registerFreshUser().token();

        ResponseEntity<Void> response = rest.exchange(
                RequestEntity.get(URI.create(PATH)).header("Authorization", "Bearer " + token).build(),
                Void.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void anAdminScrapesRealMetricsInPrometheusFormat() {
        String token = registerAdmin().token();

        ResponseEntity<String> response = rest.exchange(
                RequestEntity.get(URI.create(PATH)).header("Authorization", "Bearer " + token).build(),
                String.class);

        assertThat(response.getStatusCode())
                .as("scrape as ADMIN returned %s, body=%s", response.getStatusCode(), response.getBody())
                .isEqualTo(HttpStatus.OK);
        String body = response.getBody();
        assertThat(body).isNotNull();

        // A JVM meter proves the registry is real and exporting, not that an
        // empty 200 came back. Deliberately a BOOT-provided meter rather than
        // one of ours: a counter only appears in a scrape once it has been
        // incremented, so asserting on cotune_* here would make this test
        // depend on which other tests happened to run first in the shared
        // context — green or red by ordering, which is worse than no test.
        assertThat(body).contains("jvm_memory_used_bytes");

        // The common tag from application.yml, on the wire. Worth asserting
        // because it is pure configuration: nothing else fails if the tag
        // block is deleted, and its absence only becomes visible on the day
        // two instances' metrics need telling apart — long after the change.
        assertThat(body).contains("application=\"cotune\"");
    }
}
