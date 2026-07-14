package com.cotune.testsupport;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.auth.dto.RegisterInput;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.graphql.test.tester.HttpGraphQlTester;
import org.springframework.graphql.test.tester.GraphQlTester;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every integration test extends this — and that sameness is load-bearing,
 * not just tidy. Spring caches application contexts BY CONFIGURATION: as
 * long as all subclasses describe the identical context (same annotations,
 * same property values), the app and its Postgres container boot ONCE and
 * every test class reuses them. One divergent property on one subclass
 * forks a second context and a second container, and the suite's runtime
 * doubles. That is also why tests must isolate via unique DATA (fresh
 * random emails below) rather than by wiping shared state between classes.
 *
 * RANDOM_PORT means a real servlet container on a real socket: requests
 * cross HTTP, pass the actual security filter chain, and get serialized by
 * the actual message converters — the layers MockMvc-style tests bypass,
 * and where auth bugs live.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
public abstract class AbstractIntegrationTest {

    // Computed once per JVM, not per class: if each subclass generated its
    // own temp dir, the property VALUE would differ between classes and
    // silently defeat the context caching described above.
    private static final Path AUDIO_DIR = createAudioDir();

    @DynamicPropertySource
    static void audioStorageInTempDir(DynamicPropertyRegistry registry) {
        // Without this, AudioStorage would happily create ./data/audio in
        // whatever directory the test runner happens to execute from.
        registry.add("cotune.storage.audio-dir", AUDIO_DIR::toString);
    }

    @DynamicPropertySource
    static void relaxRateLimits(DynamicPropertyRegistry registry) {
        // The whole suite is one IP (127.0.0.1) registering a fresh user per
        // test — to the limiter that's indistinguishable from the attack it
        // exists to stop. Raise (don't disable) the budgets: the filter stays
        // in the chain, so every test still crosses it and wiring bugs still
        // surface; RateLimitFilterTest covers the 429 math with real buckets.
        // Values are constants so all subclasses share one cached context.
        registry.add("cotune.security.rate-limit.auth-per-minute", () -> 1_000_000);
        registry.add("cotune.security.rate-limit.general-per-minute", () -> 1_000_000);
    }

    @LocalServerPort
    protected int port;

    @Autowired
    protected TestRestTemplate rest;

    /**
     * Registers a brand-new account through the real endpoint and returns
     * its token. Registration doubles as test setup here on purpose: there
     * is no "insert a user row" backdoor, so every test exercises the same
     * path a real client takes — if registration breaks, everything fails
     * loudly at the root cause.
     */
    protected AuthPayload registerFreshUser() {
        // Random emails give data-level isolation in the shared database
        // (see class comment) and survive re-runs against a reused container.
        return register("it-" + UUID.randomUUID() + "@example.com",
                "correct-horse-battery", "Integration Tester");
    }

    protected AuthPayload register(String email, String password, String displayName) {
        ResponseEntity<AuthPayload> response = rest.postForEntity(
                "/api/auth/register", new RegisterInput(email, password, displayName), AuthPayload.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(response.getBody()).isNotNull();
        return response.getBody();
    }

    /**
     * A GraphQL client aimed at the real /graphql endpoint. The token rides
     * in the Authorization header exactly as the React client sends it —
     * so @PreAuthorize rules are checked against the REAL JWT decode path,
     * not a @WithMockUser shortcut that assumes the filter chain works.
     */
    protected HttpGraphQlTester graphQl(String bearerToken) {
        WebTestClient client = WebTestClient.bindToServer()
                .baseUrl("http://localhost:" + port + "/graphql")
                .defaultHeaders(headers -> {
                    if (bearerToken != null) {
                        headers.setBearerAuth(bearerToken);
                    }
                })
                .build();
        return HttpGraphQlTester.create(client);
    }

    protected HttpGraphQlTester anonymousGraphQl() {
        return graphQl(null);
    }

    /**
     * Asserts on the WIRE format: over HTTP a GraphQL error's category is
     * nothing but the "classification" string inside "extensions" — the
     * same thing the frontend switch()es on. Asserting the raw string keeps
     * the test honest about what clients actually receive (and covers our
     * custom CONFLICT classification, which no server-side enum constant
     * would match on the client side).
     */
    protected static Consumer<List<org.springframework.graphql.ResponseError>> singleErrorClassified(
            String classification) {
        return errors -> {
            assertThat(errors).hasSize(1);
            assertThat(errors.getFirst().getExtensions().get("classification"))
                    .isEqualTo(classification);
        };
    }

    /** Shorthand for the assertion above applied to a response. */
    protected static void expectSingleError(GraphQlTester.Response response, String classification) {
        response.errors().satisfy(singleErrorClassified(classification));
    }

    private static Path createAudioDir() {
        try {
            return Files.createTempDirectory("cotune-it-audio");
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot create test audio dir", e);
        }
    }
}
