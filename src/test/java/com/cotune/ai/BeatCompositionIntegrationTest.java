package com.cotune.ai;

import com.cotune.ai.dto.AiActionDto;
import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import graphql.schema.GraphQLNamedType;
import graphql.schema.GraphQLObjectType;
import graphql.schema.GraphQLSchema;
import graphql.schema.GraphQLUnionType;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.graphql.execution.GraphQlSource;
import org.springframework.graphql.test.tester.GraphQlTester;
import org.springframework.graphql.test.tester.HttpGraphQlTester;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * composeBeat's gates over real HTTP — deliberately WITHOUT a Gemini key,
 * exactly like PatternGenerationIntegrationTest and for the same reason:
 * what can be proven keylessly is precisely what must never depend on the
 * key. Who is refused, what malformed input gets, that a keyless server
 * says so instead of throwing a stack trace, and that the cooldown fires
 * before any tokens would be spent.
 *
 * The plan-building itself is pinned at the unit level
 * (BeatComposerValidateTest guards the trust boundary), with ONE exception
 * that has to live here: the union's member names are matched to Java
 * classes at RUNTIME by Spring, so no compiler checks that agreement.
 * {@link #everyUnionMemberHasAMatchingRecord} is what would fail if
 * someone renamed one side.
 */
class BeatCompositionIntegrationTest extends AbstractIntegrationTest {

    private static final String COMPOSE = """
            mutation Compose($beatId: ID!, $prompt: String!) {
                composeBeat(beatId: $beatId, prompt: $prompt) {
                    ... on SetBpm { bpm }
                    ... on AddLane { lane instrument }
                    ... on SetLanePattern { lane notes { step pitch } }
                    ... on ClearLane { lane }
                }
            }""";

    private static final String GRANT = """
            mutation Grant($email: String!) { grantAiAccess(email: $email) }""";

    @Autowired
    private GraphQlSource graphQlSource;

    /**
     * The one thing javac cannot catch about a union: Spring picks the
     * concrete type by matching a Java class's SIMPLE NAME to a GraphQL
     * type name. Rename `SetBpm` on either side and every other test still
     * passes — the break shows up only when that branch is first returned
     * to a real client, from a code path that needs an API key to reach.
     * So the agreement gets asserted directly, in both directions.
     */
    @Test
    void everyUnionMemberHasAMatchingRecord() {
        GraphQLSchema schema = graphQlSource.schema();
        GraphQLUnionType union = (GraphQLUnionType) schema.getType("AiAction");

        List<String> schemaMembers = union.getTypes().stream()
                .map(GraphQLNamedType::getName)
                .sorted()
                .toList();
        List<String> javaMembers = Arrays.stream(AiActionDto.class.getPermittedSubclasses())
                .map(Class::getSimpleName)
                .sorted()
                .toList();

        assertThat(schemaMembers).isEqualTo(javaMembers);

        // Sealed, so this is the complete list on the Java side — a fifth
        // action added to BeatComposer.TOOLS and mapped in AiActionDto but
        // forgotten in schema.graphqls fails right here.
        assertThat(javaMembers)
                .containsExactly("AddLane", "ClearLane", "SetBpm", "SetLanePattern");
    }

    /** The union's fields must line up with the records too — a record
     *  component the schema doesn't declare is unreachable, and a schema
     *  field with no component is a runtime null on a non-null type. */
    @Test
    void unionMemberFieldsMatchTheirRecordComponents() {
        GraphQLSchema schema = graphQlSource.schema();

        for (Class<?> member : AiActionDto.class.getPermittedSubclasses()) {
            GraphQLObjectType type = (GraphQLObjectType) schema.getType(member.getSimpleName());
            assertThat(type).as("schema type for %s", member.getSimpleName()).isNotNull();

            List<String> schemaFields = type.getFieldDefinitions().stream()
                    .map(field -> field.getName())
                    .sorted()
                    .toList();
            List<String> recordComponents = Arrays.stream(member.getRecordComponents())
                    .map(component -> component.getName())
                    .sorted()
                    .toList();

            assertThat(schemaFields)
                    .as("fields of %s", member.getSimpleName())
                    .isEqualTo(recordComponents);
        }
    }

    @Test
    void strangersViewersAndTheUninvitedAreAllRefused() {
        AuthPayload owner = registerFreshUser();
        SongBeatIds ids = createBeat(graphQl(owner.token()));
        UUID beatId = ids.beatId();

        // No token: UNAUTHORIZED before anything else is considered.
        expectSingleError(
                anonymousGraphQl().document(COMPOSE)
                        .variable("beatId", beatId).variable("prompt", "a sad beat").execute(),
                "UNAUTHORIZED");

        // A stranger with a valid account: canEdit says no.
        AuthPayload stranger = registerFreshUser();
        expectSingleError(
                graphQl(stranger.token()).document(COMPOSE)
                        .variable("beatId", beatId).variable("prompt", "a sad beat").execute(),
                "FORBIDDEN");

        // A VIEWER can open the song but not write to it — and a plan is
        // headed for the song, so the edit rule applies.
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
                graphQl(viewer.token()).document(COMPOSE)
                        .variable("beatId", beatId).variable("prompt", "a sad beat").execute(),
                "FORBIDDEN");

        // The owner may edit — but the AI is invite-only (V13), and nobody
        // put this account on the list.
        GraphQlTester.Response uninvited = graphQl(owner.token()).document(COMPOSE)
                .variable("beatId", beatId).variable("prompt", "a sad beat").execute();
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
        UUID beatId = createBeat(graphQl).beatId();

        expectSingleError(
                graphQl.document(COMPOSE)
                        .variable("beatId", beatId).variable("prompt", "   ").execute(),
                "BAD_REQUEST");

        expectSingleError(
                graphQl.document(COMPOSE)
                        .variable("beatId", beatId).variable("prompt", "x".repeat(301)).execute(),
                "BAD_REQUEST");
    }

    @Test
    void keylessServerSaysSoAndTheCooldownStillHolds() {
        // An invited account on a server with no GEMINI_API_KEY — the exact
        // state of CI and a fresh deploy.
        AuthPayload admin = registerAdmin();
        AuthPayload owner = registerFreshUser();
        graphQl(admin.token()).document(GRANT)
                .variable("email", owner.user().email()).execute()
                .path("grantAiAccess").entity(Boolean.class).isEqualTo(true);

        HttpGraphQlTester graphQl = graphQl(owner.token());
        UUID beatId = createBeat(graphQl).beatId();

        // First ask: UNAVAILABLE with the operator-actionable message —
        // never an INTERNAL_ERROR with the reason stripped.
        graphQl.document(COMPOSE)
                .variable("beatId", beatId).variable("prompt", "a sad lofi beat").execute()
                .errors().satisfy(errors -> {
                    assertThat(errors).hasSize(1);
                    assertThat(errors.getFirst().getExtensions().get("classification"))
                            .isEqualTo("UNAVAILABLE");
                    assertThat(errors.getFirst().getMessage()).contains("isn't configured");
                });

        // Immediately again: the per-user cooldown answers first. It was
        // recorded BEFORE the key check on purpose — the gate order must not
        // depend on which failure happens to be behind it.
        graphQl.document(COMPOSE)
                .variable("beatId", beatId).variable("prompt", "a sad lofi beat").execute()
                .errors().satisfy(errors -> {
                    assertThat(errors).hasSize(1);
                    assertThat(errors.getFirst().getExtensions().get("classification"))
                            .isEqualTo("UNAVAILABLE");
                    assertThat(errors.getFirst().getMessage()).contains("One generation at a time");
                });
    }

    /**
     * The cooldown is ONE budget per person, not one per mutation — proving
     * the shared-gate claim in AiGraphqlController's javadoc. Alternating
     * between the two AI mutations must not buy a caller double the rate.
     */
    @Test
    void theCooldownIsSharedWithPatternGeneration() {
        AuthPayload admin = registerAdmin();
        AuthPayload owner = registerFreshUser();
        graphQl(admin.token()).document(GRANT)
                .variable("email", owner.user().email()).execute()
                .path("grantAiAccess").entity(Boolean.class).isEqualTo(true);

        HttpGraphQlTester graphQl = graphQl(owner.token());
        SongBeatIds ids = createBeat(graphQl);
        UUID trackId = graphQl.document("""
                        mutation AddTrack($input: AddTrackInput!) {
                            addTrack(input: $input) { id }
                        }""")
                .variable("input", Map.of("beatId", ids.beatId(), "name", "Kick", "instrument", "DRUMS"))
                .execute()
                .path("addTrack.id").entity(UUID.class).get();

        // Spend the turn on composeBeat (keyless: UNAVAILABLE, but the
        // cooldown was recorded before the key was ever considered).
        graphQl.document(COMPOSE)
                .variable("beatId", ids.beatId()).variable("prompt", "a sad lofi beat")
                .execute().errors().satisfy(errors -> assertThat(errors).hasSize(1));

        // The OTHER mutation now finds the same window closed.
        graphQl.document("""
                        mutation Generate($trackId: ID!, $prompt: String!) {
                            generateTrackPattern(trackId: $trackId, prompt: $prompt) { step pitch }
                        }""")
                .variable("trackId", trackId).variable("prompt", "a boom-bap kick").execute()
                .errors().satisfy(errors -> {
                    assertThat(errors).hasSize(1);
                    assertThat(errors.getFirst().getMessage()).contains("One generation at a time");
                });
    }

    // ---- plumbing ----------------------------------------------------------

    private record SongBeatIds(UUID songId, UUID beatId) {
    }

    /** Song → beat through the real API. */
    private SongBeatIds createBeat(HttpGraphQlTester graphQl) {
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
        return new SongBeatIds(songId, beatId);
    }
}
