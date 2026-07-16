package com.cotune.common.web;

import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * EVERY CLIENT-SIDE ROUTE MUST SURVIVE A HARD REFRESH.
 *
 * The bug this guards is a deploy-only one, which is the worst kind. React
 * Router owns URLs like /songs, but it does not exist until index.html has
 * been served — so on a refresh (or a pasted link, or a bookmark) the
 * BROWSER asks the SERVER for /songs, and the server has to know to hand
 * back the shell. Two separate places must agree for that to happen:
 *
 *   SpaForwardingController — a @GetMapping, or no handler exists      → 404
 *   SecurityConfig          — a permitAll, or deny-by-default wins     → 403
 *
 * Forget either and the app still passes every other test here, still works
 * perfectly in dev (Vite serves the shell for any path, so the server-side
 * lists are never consulted), and breaks the first time a real user
 * refreshes a real page in production.
 *
 * It takes a fixture to test at all: `mvn test` never runs Vite, so there is
 * normally no classpath:/static/index.html and EVERY forward 404s for a
 * boring reason — indistinguishable from a route nobody registered. See
 * src/test/resources/static/index.html, which exists solely to tell those
 * two 404s apart.
 */
class SpaRoutesIntegrationTest extends AbstractIntegrationTest {

    /** Rendered into the stub shell; proves we were served the SPA and not
     *  something else that merely also returns 200. */
    private static final String SHELL_MARKER = "spa-forwarding-stub";

    /**
     * Every path React Router answers. Add a <Route> in App.tsx and it belongs
     * here — and adding it here WITHOUT updating SpaForwardingController and
     * SecurityConfig fails this test, which is the entire point.
     *
     * The two with ids use throwaway values on purpose: forwarding is a
     * question about the URL's SHAPE. Nothing looks the id up, and a listen
     * token that resolves to nothing still has to serve the app so the client
     * can say "this link is dead" in the UI rather than as a stack trace.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "/",
            "/login",
            "/register",
            "/songs",
            "/songs/00000000-0000-0000-0000-000000000000",
            "/listen/some-opaque-token",
    })
    void everySpaRouteServesTheAppShell(String route) {
        ResponseEntity<String> response = rest.getForEntity(route, String.class);
        HttpStatus status = HttpStatus.valueOf(response.getStatusCode().value());

        assertThat(status)
                .as("""
                        GET %s answered %s. A client-side route must be BOTH forwarded \
                        (SpaForwardingController's @GetMapping) and permitted \
                        (SecurityConfig's permitAll list). 403 means security's list is \
                        missing it; 404 means the controller's is. Either way, a user who \
                        refreshes %s in production gets an error page instead of the app.""",
                        route, status, route)
                .isEqualTo(HttpStatus.OK);

        assertThat(response.getBody())
                .as("GET %s returned 200 but not the SPA shell", route)
                .contains(SHELL_MARKER);
    }

    /**
     * The other half of deny-by-default: being generous to the SPA's routes
     * must not have been generous to anything else. A path nobody registered
     * is still refused — so this test is a list of what IS public, not a
     * blanket /** fallback that would swallow real 404s and hand out HTML
     * with a 200 for every typo'd asset path.
     */
    @Test
    void anUnknownPathIsStillNotServedTheApp() {
        ResponseEntity<String> response = rest.getForEntity("/definitely-not-a-route", String.class);

        assertThat(response.getStatusCode().value())
                .as("an unregistered path must not be forwarded to the SPA")
                .isNotEqualTo(200);
    }
}
