package com.cotune.user;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The AI invitation list over real HTTP: hasRole('ADMIN') on the mutations
 * is only proven here (a unit test can't show the annotation is processed,
 * or that the roles claim in a real JWT becomes ROLE_ADMIN), and the grant
 * must be visible where the client reads it — /api/auth/me.
 */
class AiAccessIntegrationTest extends AbstractIntegrationTest {

    private static final String GRANT = """
            mutation Grant($email: String!) { grantAiAccess(email: $email) }""";
    private static final String REVOKE = """
            mutation Revoke($email: String!) { revokeAiAccess(email: $email) }""";

    @Test
    void ordinaryUsersAndStrangersCannotTouchTheInvitationList() {
        AuthPayload user = registerFreshUser();

        // A regular USER holding a perfectly valid token: FORBIDDEN — this
        // is app administration, not something song ownership implies.
        expectSingleError(
                graphQl(user.token()).document(GRANT)
                        .variable("email", user.user().email()).execute(),
                "FORBIDDEN");

        // No token at all: UNAUTHORIZED.
        expectSingleError(
                anonymousGraphQl().document(GRANT)
                        .variable("email", user.user().email()).execute(),
                "UNAUTHORIZED");
    }

    @Test
    void anAdminGrantsAndRevokesAndTheClientSeesItOnMe() {
        AuthPayload admin = registerAdmin();
        AuthPayload user = registerFreshUser();

        // Fresh accounts start OUTSIDE the list.
        assertThat(aiAccessOnMe(user.token())).isFalse();
        // The admin themselves never needs an entry — the role suffices.
        assertThat(aiAccessOnMe(admin.token())).isTrue();

        graphQl(admin.token()).document(GRANT)
                .variable("email", user.user().email()).execute()
                .path("grantAiAccess").entity(Boolean.class).isEqualTo(true);
        assertThat(aiAccessOnMe(user.token())).isTrue();

        graphQl(admin.token()).document(REVOKE)
                .variable("email", user.user().email()).execute()
                .path("revokeAiAccess").entity(Boolean.class).isEqualTo(true);
        assertThat(aiAccessOnMe(user.token())).isFalse();
    }

    @Test
    void grantingAnUnknownAddressIsNotFoundSoTheAdminCanSpotTheTypo() {
        AuthPayload admin = registerAdmin();

        expectSingleError(
                graphQl(admin.token()).document(GRANT)
                        .variable("email", "nobody-" + UUID.randomUUID() + "@example.com")
                        .execute(),
                "NOT_FOUND");
    }

    /** What the frontend actually reads: UserDto.aiAccess on /api/auth/me. */
    private boolean aiAccessOnMe(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/api/auth/me", HttpMethod.GET, new HttpEntity<>(headers),
                new ParameterizedTypeReference<>() {
                });
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        return Boolean.TRUE.equals(response.getBody().get("aiAccess"));
    }
}
