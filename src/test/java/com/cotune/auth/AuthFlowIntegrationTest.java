package com.cotune.auth;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.auth.dto.LoginInput;
import com.cotune.auth.dto.RegisterInput;
import com.cotune.testsupport.AbstractIntegrationTest;
import com.cotune.user.dto.UserDto;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The full credential lifecycle over real HTTP: register → token → use the
 * token → fail correctly without it. AuthServiceImplTest already covers
 * the business rules with mocks; what THIS test adds is everything mocks
 * assume away — the security filter chain order, JWT encode/decode against
 * the real key, JSON (de)serialization, and the status codes clients see.
 */
class AuthFlowIntegrationTest extends AbstractIntegrationTest {

    @Test
    void registerIssuesATokenThatTheFilterChainAccepts() {
        AuthPayload payload = registerFreshUser();

        assertThat(payload.token()).isNotBlank();
        // expiresAt exists so clients can schedule re-login proactively;
        // a token already expired at issue time would defeat that.
        assertThat(payload.expiresAt()).isAfter(OffsetDateTime.now());
        assertThat(payload.user().id()).isNotNull();

        // The round trip that matters: the token we MINTED must satisfy the
        // VERIFYING side (Bearer filter → JwtDecoder → SecurityContext).
        // Encoder and decoder are configured separately in SecurityConfig —
        // a key or algorithm mismatch between them appears exactly here.
        ResponseEntity<UserDto> me = rest.exchange(
                "/api/auth/me", HttpMethod.GET, withBearer(payload.token()), UserDto.class);

        assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
        // `me` resolves the JWT's sub claim back to a database row — this
        // equality proves the id survived mint → transport → decode intact.
        assertThat(me.getBody().id()).isEqualTo(payload.user().id());
    }

    @Test
    void rateLimiterSitsInFrontOfTheAuthEndpoints() {
        AuthPayload payload = registerFreshUser();
        ResponseEntity<AuthPayload> login = rest.postForEntity(
                "/api/auth/login",
                new LoginInput(payload.user().email(), "correct-horse-battery"),
                AuthPayload.class);

        // Not testing the 429 here — the suite runs with raised budgets (see
        // AbstractIntegrationTest) and RateLimitFilterTest owns the math.
        // This asserts the part a unit test CANNOT: the filter is actually
        // registered and ordered into the real chain, proven by its header
        // on a response that crossed real HTTP.
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(login.getHeaders().getFirst("X-RateLimit-Remaining")).isNotNull();
    }

    @Test
    void meWithoutATokenIs401() {
        ResponseEntity<Void> response = rest.getForEntity("/api/auth/me", Void.class);

        // 401 (unauthenticated), not 403 (unauthorized): the request never
        // identified itself, so "who are you" is the right complaint.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        // RFC 6750: a bearer-protected endpoint must advertise HOW to
        // authenticate. Spring's entry point sets this header for us.
        assertThat(response.getHeaders().getFirst(HttpHeaders.WWW_AUTHENTICATE)).contains("Bearer");
    }

    @Test
    void duplicateEmailIs409NotA500() {
        String email = "dup-" + UUID.randomUUID() + "@example.com";
        register(email, "correct-horse-battery", "First");

        ResponseEntity<ProblemDetail> second = rest.postForEntity(
                "/api/auth/register",
                new RegisterInput(email, "different-password", "Second"),
                ProblemDetail.class);

        // 409: the request was well-formed, it conflicts with existing
        // STATE. Without the service-level uniqueness check this would
        // surface as the DB's unique-constraint exception → 500 — same
        // outcome for the row, wrong contract for the client.
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void wrongPasswordAndUnknownEmailAreIndistinguishable() {
        String email = "victim-" + UUID.randomUUID() + "@example.com";
        register(email, "correct-horse-battery", "Victim");

        ResponseEntity<ProblemDetail> wrongPassword = rest.postForEntity(
                "/api/auth/login", new LoginInput(email, "not-the-password"), ProblemDetail.class);
        ResponseEntity<ProblemDetail> unknownEmail = rest.postForEntity(
                "/api/auth/login", new LoginInput("nobody-" + UUID.randomUUID() + "@example.com",
                        "not-the-password"), ProblemDetail.class);

        assertThat(wrongPassword.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(unknownEmail.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        // THE assertion of this test: identical bodies, so a caller cannot
        // probe which emails have accounts (user enumeration). One helpful
        // "no such user" message would undo the fixed message in
        // RestExceptionHandler.
        assertThat(wrongPassword.getBody().getDetail())
                .isEqualTo(unknownEmail.getBody().getDetail());
    }

    @Test
    void validationErrorsArriveTogetherNotOneAtATime() {
        // Two invalid fields at once. Read as a Map (the raw wire shape)
        // because we're asserting on the ProblemDetail EXTENSION property,
        // which is our own contract, not standard RFC 7807 fields.
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/api/auth/register", HttpMethod.POST,
                new HttpEntity<>(new RegisterInput("not-an-email", "short", "X")),
                new ParameterizedTypeReference<>() {
                });

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        @SuppressWarnings("unchecked")
        Map<String, String> errors = (Map<String, String>) response.getBody().get("errors");
        // Both failures in ONE response — the form is fixable in a single
        // round trip instead of error-whack-a-mole.
        assertThat(errors).containsKeys("email", "password");
    }

    private static HttpEntity<Void> withBearer(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return new HttpEntity<>(headers);
    }
}
