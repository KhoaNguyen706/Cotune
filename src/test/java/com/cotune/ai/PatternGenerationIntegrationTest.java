package com.cotune.ai;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.graphql.test.tester.GraphQlTester;
import org.springframework.graphql.test.tester.HttpGraphQlTester;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * generateTrackPattern's gates over real HTTP — deliberately WITHOUT an
 * Anthropic key, like CI and every fresh deploy. What can be proven
 * keylessly is exactly what must never depend on the key: who is refused
 * (strangers, viewers, the uninvited), what malformed input gets, that a
 * keyless server answers with a configured-operator message instead of a
 * stack trace, and that the cooldown fires before any tokens would be
 * spent. The one thing that needs a real key — the model round trip — is
 * pinned at the unit level instead (PatternGeneratorSanitizeTest guards
 * the trust boundary).
 */
class PatternGenerationIntegrationTest extends AbstractIntegrationTest {

    private static final String GENERATE = """
            mutation Generate($trackId: ID!, $prompt: String!) {
                generateTrackPattern(trackId: $trackId, prompt: $prompt) { step pitch }
            }""";

    private static final String GRANT = """
            mutation Grant($email: String!) { grantAiAccess(email: $email) }""";

    @Test
    void strangersViewersAndTheUninvitedAreAllRefused() {
        AuthPayload owner = registerFreshUser();
        SongTrackIds ids = createTrack(graphQl(owner.token()));
        UUID trackId = ids.trackId();

        // No token: UNAUTHORIZED before anything else is considered.
        expectSingleError(
                anonymousGraphQl().document(GENERATE)
                        .variable("trackId", trackId).variable("prompt", "a beat").execute(),
                "UNAUTHORIZED");

        // A stranger with a valid account: canEdit says no.
        AuthPayload stranger = registerFreshUser();
        expectSingleError(
                graphQl(stranger.token()).document(GENERATE)
                        .variable("trackId", trackId).variable("prompt", "a beat").execute(),
                "FORBIDDEN");

        // A VIEWER can open the song but not write to it — and generated
        // notes are headed for the song, so the edit rule applies.
        AuthPayload viewer = registerFreshUser();
        graphQl(owner.token()).document("""
                        mutation Share($input: ShareSongInput!) {
                            shareSong(input: $input) { userId }
                        }""")
                .variable("input", Map.of(
                        "songId", ids.songId(),
                        "email", viewer.user().email(),
                        "role", "VIEWER"))
                .execute()
                .path("shareSong.userId").hasValue();
        expectSingleError(
                graphQl(viewer.token()).document(GENERATE)
                        .variable("trackId", trackId).variable("prompt", "a beat").execute(),
                "FORBIDDEN");

        // The owner may edit — but the AI is invite-only (V13), and nobody
        // put this account on the list.
        GraphQlTester.Response uninvited = graphQl(owner.token()).document(GENERATE)
                .variable("trackId", trackId).variable("prompt", "a beat").execute();
        uninvited.errors().satisfy(errors -> {
            assertThat(errors).hasSize(1);
            assertThat(errors.getFirst().getExtensions().get("classification"))
                    .isEqualTo("FORBIDDEN");
        });
    }

    @Test
    void malformedPromptsAreBadRequestBeforeAnyTokensWouldBeSpent() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester graphQl = graphQl(owner.token());
        UUID trackId = createTrack(graphQl).trackId();

        expectSingleError(
                graphQl.document(GENERATE)
                        .variable("trackId", trackId).variable("prompt", "   ").execute(),
                "BAD_REQUEST");

        expectSingleError(
                graphQl.document(GENERATE)
                        .variable("trackId", trackId).variable("prompt", "x".repeat(301)).execute(),
                "BAD_REQUEST");
    }

    @Test
    void keylessServerSaysSoAndTheCooldownStillHolds() {
        // An invited account on a server with no ANTHROPIC_API_KEY — the
        // exact state of CI and a fresh deploy.
        AuthPayload admin = registerAdmin();
        AuthPayload owner = registerFreshUser();
        graphQl(admin.token()).document(GRANT)
                .variable("email", owner.user().email()).execute()
                .path("grantAiAccess").entity(Boolean.class).isEqualTo(true);

        HttpGraphQlTester graphQl = graphQl(owner.token());
        UUID trackId = createTrack(graphQl).trackId();

        // First ask: UNAVAILABLE with the operator-actionable message —
        // never an INTERNAL_ERROR with the reason stripped.
        graphQl.document(GENERATE)
                .variable("trackId", trackId).variable("prompt", "a boom-bap kick").execute()
                .errors().satisfy(errors -> {
                    assertThat(errors).hasSize(1);
                    assertThat(errors.getFirst().getExtensions().get("classification"))
                            .isEqualTo("UNAVAILABLE");
                    assertThat(errors.getFirst().getMessage()).contains("isn't configured");
                });

        // Immediately again: the per-user cooldown answers first. It was
        // recorded BEFORE the key check on purpose — the gate order must
        // not depend on which failure happens to be behind it.
        graphQl.document(GENERATE)
                .variable("trackId", trackId).variable("prompt", "a boom-bap kick").execute()
                .errors().satisfy(errors -> {
                    assertThat(errors).hasSize(1);
                    assertThat(errors.getFirst().getExtensions().get("classification"))
                            .isEqualTo("UNAVAILABLE");
                    assertThat(errors.getFirst().getMessage()).contains("One generation at a time");
                });
    }

    // ---- plumbing ----------------------------------------------------------

    private record SongTrackIds(UUID songId, UUID trackId) {
    }

    /** Song → beat → lane through the real API. */
    private SongTrackIds createTrack(HttpGraphQlTester graphQl) {
        UUID songId = graphQl.document("""
                        mutation Create($input: CreateSongInput!) {
                            createSong(input: $input) { id }
                        }""")
                .variable("input", Map.of("title", "AI Host", "bpm", 90, "timeSignature", "4/4"))
                .execute()
                .path("createSong.id").entity(UUID.class).get();
        UUID beatId = graphQl.document("""
                        mutation AddBeat($input: AddBeatInput!) {
                            addBeat(input: $input) { id }
                        }""")
                .variable("input", Map.of("songId", songId, "name", "Beat 1"))
                .execute()
                .path("addBeat.id").entity(UUID.class).get();
        UUID trackId = graphQl.document("""
                        mutation AddTrack($input: AddTrackInput!) {
                            addTrack(input: $input) { id }
                        }""")
                .variable("input", Map.of("beatId", beatId, "name", "Kick", "instrument", "DRUMS"))
                .execute()
                .path("addTrack.id").entity(UUID.class).get();
        return new SongTrackIds(songId, trackId);
    }
}
