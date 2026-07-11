package com.cotune.song;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.graphql.test.tester.GraphQlTester;
import org.springframework.graphql.test.tester.HttpGraphQlTester;

import java.util.Map;
import java.util.UUID;

/**
 * The song lifecycle through the real transport: HTTP POST /graphql with a
 * real bearer token. SongAccessTest already enumerates the authorization
 * DECISIONS in fast unit tests; this class verifies the WIRING — that
 * @EnableMethodSecurity actually processes the @PreAuthorize annotations,
 * that the SpEL finds the @songAccess bean, and that denials surface as
 * the error classifications the frontend switches on. Miswire any of that
 * and the unit tests stay green while the API is either broken or,
 * worse, silently public.
 */
class SongGraphqlIntegrationTest extends AbstractIntegrationTest {

    private static final String CREATE_SONG = """
            mutation Create($input: CreateSongInput!) {
                createSong(input: $input) { id title bpm timeSignature ownerId version }
            }""";

    private static final String SONG_BY_ID = """
            query Song($id: ID!) {
                song(id: $id) { id title version }
            }""";

    @Test
    void anonymousMutationIsRejectedWithUnauthorized() {
        GraphQlTester.Response response = anonymousGraphQl()
                .document(CREATE_SONG)
                .variable("input", songInput("Sneaky"))
                .execute();

        // Reaching /graphql anonymously is allowed (SecurityConfig
        // permitAll) — the rejection MUST therefore come from method
        // security on the resolver. This test fails if someone deletes
        // @EnableMethodSecurity, which no unit test would notice.
        expectSingleError(response, "UNAUTHORIZED");
    }

    @Test
    void createdSongBelongsToTheCallerAndReadsBack() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester graphQl = graphQl(owner.token());

        GraphQlTester.Response created = graphQl
                .document(CREATE_SONG)
                .variable("input", songInput("Neon Drift"))
                .execute();

        UUID songId = created.path("createSong.id").entity(UUID.class).get();
        // ownerId must equal the TOKEN's subject: the controller takes the
        // owner from Authentication, never from client input. If ownerId
        // were an input field, this is where impersonation would show up.
        created.path("createSong.ownerId").entity(UUID.class).isEqualTo(owner.user().id());
        // @Version starts at 0; clients echo it back later for
        // optimistic-concurrency checks.
        created.path("createSong.version").entity(Integer.class).isEqualTo(0);

        // Read back through a separate request → separate transaction:
        // proves the row was committed to real Postgres, not merely alive
        // in a persistence context that a rollback would erase.
        graphQl.document(SONG_BY_ID)
                .variable("id", songId)
                .execute()
                .path("song.title").entity(String.class).isEqualTo("Neon Drift");
    }

    @Test
    void onlyTheOwnerMayUpdateOrDelete() {
        AuthPayload owner = registerFreshUser();
        AuthPayload intruder = registerFreshUser();

        UUID songId = graphQl(owner.token())
                .document(CREATE_SONG)
                .variable("input", songInput("Owner Only"))
                .execute()
                .path("createSong.id").entity(UUID.class).get();

        String updateSong = """
                mutation Update($id: ID!, $input: UpdateSongInput!) {
                    updateSong(id: $id, input: $input) { id title version }
                }""";
        String deleteSong = """
                mutation Delete($id: ID!) { deleteSong(id: $id) }""";

        // A perfectly authenticated user who simply isn't the owner:
        // FORBIDDEN ("I know who you are; you may not"), distinct from the
        // UNAUTHORIZED of the anonymous test ("I don't know who you are").
        GraphQlTester.Response intruderUpdate = graphQl(intruder.token())
                .document(updateSong)
                .variable("id", songId)
                .variable("input", songInput("Hijacked"))
                .execute();
        expectSingleError(intruderUpdate, "FORBIDDEN");

        GraphQlTester.Response intruderDelete = graphQl(intruder.token())
                .document(deleteSong)
                .variable("id", songId)
                .execute();
        expectSingleError(intruderDelete, "FORBIDDEN");

        // The owner's update goes through and bumps the version — the
        // counter the CONFLICT machinery (TrackPattern test) hangs off.
        GraphQlTester.Response ownerUpdate = graphQl(owner.token())
                .document(updateSong)
                .variable("id", songId)
                .variable("input", songInput("Renamed by Owner"))
                .execute();
        ownerUpdate.path("updateSong.version").entity(Integer.class).isEqualTo(1);

        graphQl(owner.token())
                .document(deleteSong)
                .variable("id", songId)
                .execute()
                .path("deleteSong").entity(Boolean.class).isEqualTo(true);

        // After deletion: NOT_FOUND in "errors" AND data.song = null —
        // the nullable-field idiom the schema comment promises. Both halves
        // matter to clients: the error carries WHY, the null keeps the rest
        // of the response usable.
        graphQl(owner.token())
                .document(SONG_BY_ID)
                .variable("id", songId)
                .execute()
                .errors()
                .expect(error -> "NOT_FOUND".equals(
                        String.valueOf(error.getExtensions().get("classification"))))
                .verify()
                .path("song").valueIsNull();
    }

    @Test
    void intruderDenialLooksLikeMissingSongWouldNot() {
        // Guard against id-probing: deleting a NONEXISTENT song as a random
        // user must NOT say FORBIDDEN (that would confirm the id exists —
        // SongAccess deliberately lets missing ids through so the service
        // can 404). Verify the end-to-end contract here.
        AuthPayload someone = registerFreshUser();

        GraphQlTester.Response response = graphQl(someone.token())
                .document("mutation Delete($id: ID!) { deleteSong(id: $id) }")
                .variable("id", UUID.randomUUID())
                .execute();

        expectSingleError(response, "NOT_FOUND");
    }

    private static Map<String, Object> songInput(String title) {
        return Map.of("title", title, "bpm", 120, "timeSignature", "4/4");
    }
}
