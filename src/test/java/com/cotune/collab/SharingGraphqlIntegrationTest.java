package com.cotune.collab;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.graphql.test.tester.GraphQlTester;
import org.springframework.graphql.test.tester.HttpGraphQlTester;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Sharing, end to end, over real HTTP against real Postgres.
 *
 * The unit tests enumerate the permission matrix; this class proves the parts
 * that unit tests structurally cannot: that @PreAuthorize("...canShare...")
 * is actually processed, that the SpEL resolves #input.songId out of a nested
 * input object, that a denial arrives as the FORBIDDEN classification the
 * frontend switches on, and — the one that would otherwise go unnoticed —
 * that the songs query does not hand a stranger somebody else's work.
 *
 * That last test is the regression guard for a hole that shipped: until V10
 * `songs` called findAll(), so every logged-in user was served every song in
 * the database. Nothing failed. The UI just never asked, so nobody saw it.
 */
class SharingGraphqlIntegrationTest extends AbstractIntegrationTest {

    private static final String CREATE_SONG = """
            mutation Create($input: CreateSongInput!) {
                createSong(input: $input) { id }
            }""";

    private static final String MY_LIBRARY = """
            query Library {
                songs {
                    id
                    title
                    myRole
                    collaborators { userId email displayName role }
                }
            }""";

    private static final String SONG_BY_ID = """
            query Song($id: ID!) { song(id: $id) { id title myRole } }""";

    private static final String SHARE = """
            mutation Share($input: ShareSongInput!) {
                shareSong(input: $input) { userId email displayName role createdAt }
            }""";

    private static final String UNSHARE = """
            mutation Unshare($songId: ID!, $userId: ID!) {
                unshareSong(songId: $songId, userId: $userId)
            }""";

    private static final String RENAME = """
            mutation Rename($id: ID!, $input: UpdateSongInput!) {
                updateSong(id: $id, input: $input) { id title }
            }""";

    private static final String DELETE = """
            mutation Delete($id: ID!) { deleteSong(id: $id) }""";

    // ---- the read hole this session closed ---------------------------------

    @Test
    void aStrangerCanNeitherListNorOpenSomeoneElsesSong() {
        AuthPayload alice = registerFreshUser();
        AuthPayload stranger = registerFreshUser();
        UUID songId = createSong(alice, "Private Sketch");

        // The list must be scoped to the CALLER. Before V10 this returned
        // Alice's song (and everyone else's) to this brand-new account.
        graphQl(stranger.token())
                .document(MY_LIBRARY)
                .execute()
                .path("songs").entityList(Object.class).hasSize(0);

        // ...and neither can they reach it by guessing the id: reads are now
        // object-level authorized, not merely authenticated.
        expectSingleError(
                graphQl(stranger.token()).document(SONG_BY_ID).variable("id", songId).execute(),
                "FORBIDDEN");
    }

    // ---- the happy path ----------------------------------------------------

    @Test
    void sharedSongAppearsInTheInviteesLibraryWithTheirRole() {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Collab Sketch");

        GraphQlTester.Response shared = graphQl(alice.token())
                .document(SHARE)
                .variable("input", shareInput(songId, bob.user().email(), "EDITOR"))
                .execute();

        shared.path("shareSong.email").entity(String.class).isEqualTo(bob.user().email());
        shared.path("shareSong.role").entity(String.class).isEqualTo("EDITOR");
        // created_at is written by @CreationTimestamp on INSERT — which is
        // deferred to commit. Without the service's flush() this is null.
        shared.path("shareSong.createdAt").hasValue();

        // Bob's library now holds a song he did not create, and the server —
        // not the client — tells him what he may do with it.
        HttpGraphQlTester bobsClient = graphQl(bob.token());
        bobsClient.document(MY_LIBRARY).execute()
                .path("songs[0].title").entity(String.class).isEqualTo("Collab Sketch")
                .path("songs[0].myRole").entity(String.class).isEqualTo("EDITOR");

        // Alice sees the same song as its OWNER, with Bob on the guest list.
        graphQl(alice.token()).document(MY_LIBRARY).execute()
                .path("songs[0].myRole").entity(String.class).isEqualTo("OWNER")
                .path("songs[0].collaborators[0].displayName").entity(String.class).isEqualTo("Integration Tester")
                .path("songs[0].collaborators[0].role").entity(String.class).isEqualTo("EDITOR");
    }

    // ---- where EDITOR stops ------------------------------------------------

    @Test
    void editorMayChangeTheMusicButNotTheGuestListOrTheSongsExistence() {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        AuthPayload carol = registerFreshUser();
        UUID songId = createSong(alice, "Editable");
        shareWith(alice, songId, bob, "EDITOR");

        HttpGraphQlTester bobsClient = graphQl(bob.token());

        // He can edit — that is what EDITOR means.
        bobsClient.document(RENAME)
                .variable("id", songId)
                .variable("input", songInput("Renamed By Bob"))
                .execute()
                .path("updateSong.title").entity(String.class).isEqualTo("Renamed By Bob");

        // He cannot invite anyone else. This is the escalation this design
        // exists to prevent: an editor who could share could hand out further
        // editor seats, and access would spread beyond the owner's sight.
        expectSingleError(
                bobsClient.document(SHARE)
                        .variable("input", shareInput(songId, carol.user().email(), "EDITOR"))
                        .execute(),
                "FORBIDDEN");

        // He cannot evict the owner's other guests...
        expectSingleError(
                bobsClient.document(UNSHARE)
                        .variable("songId", songId)
                        .variable("userId", bob.user().id())
                        .execute(),
                "FORBIDDEN");

        // ...and he cannot destroy work he does not own.
        expectSingleError(
                bobsClient.document(DELETE).variable("id", songId).execute(),
                "FORBIDDEN");
    }

    @Test
    void viewerMayOpenTheSongButEveryWriteIsRefused() {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Read Only");
        shareWith(alice, songId, bob, "VIEWER");

        HttpGraphQlTester bobsClient = graphQl(bob.token());

        bobsClient.document(SONG_BY_ID).variable("id", songId).execute()
                .path("song.myRole").entity(String.class).isEqualTo("VIEWER");

        expectSingleError(
                bobsClient.document(RENAME)
                        .variable("id", songId)
                        .variable("input", songInput("Nope"))
                        .execute(),
                "FORBIDDEN");
    }

    // ---- changing your mind ------------------------------------------------

    @Test
    void resharingDemotesInPlaceAndUnsharingRevokesAccessEntirely() {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Demote Me");
        shareWith(alice, songId, bob, "EDITOR");

        // Re-sharing is an UPDATE, not a duplicate row — the share sheet needs
        // to be able to flip EDITOR to VIEWER without a separate mutation, and
        // the composite PK would reject a second insert anyway.
        shareWith(alice, songId, bob, "VIEWER");

        graphQl(alice.token()).document(MY_LIBRARY).execute()
                .path("songs[0].collaborators").entityList(Object.class).hasSize(1)
                .path("songs[0].collaborators[0].role").entity(String.class).isEqualTo("VIEWER");

        graphQl(bob.token()).document(SONG_BY_ID).variable("id", songId).execute()
                .path("song.myRole").entity(String.class).isEqualTo("VIEWER");

        // Now revoke entirely. Bob falls back to being a stranger: the song
        // leaves his library and he can no longer open it by id.
        graphQl(alice.token())
                .document(UNSHARE)
                .variable("songId", songId)
                .variable("userId", bob.user().id())
                .execute()
                .path("unshareSong").entity(Boolean.class).isEqualTo(true);

        graphQl(bob.token()).document(MY_LIBRARY).execute()
                .path("songs").entityList(Object.class).hasSize(0);

        expectSingleError(
                graphQl(bob.token()).document(SONG_BY_ID).variable("id", songId).execute(),
                "FORBIDDEN");
    }

    // ---- input the API must refuse ----------------------------------------

    @Test
    void sharingWithYourselfIsRejected() {
        AuthPayload alice = registerFreshUser();
        UUID songId = createSong(alice, "Mine Already");

        expectSingleError(
                graphQl(alice.token())
                        .document(SHARE)
                        .variable("input", shareInput(songId, alice.user().email(), "EDITOR"))
                        .execute(),
                "BAD_REQUEST");
    }

    @Test
    void invitingAnAddressThatHasNoAccountIsNotFound() {
        AuthPayload alice = registerFreshUser();
        UUID songId = createSong(alice, "Lonely");

        expectSingleError(
                graphQl(alice.token())
                        .document(SHARE)
                        .variable("input", shareInput(songId, "nobody-" + UUID.randomUUID() + "@example.com", "EDITOR"))
                        .execute(),
                "NOT_FOUND");
    }

    @Test
    void aMalformedEmailIsRejectedBeforeAnyDatabaseWork() {
        AuthPayload alice = registerFreshUser();
        UUID songId = createSong(alice, "Validated");

        // Bean Validation at the GraphQL boundary (@Valid on the resolver).
        expectSingleError(
                graphQl(alice.token())
                        .document(SHARE)
                        .variable("input", shareInput(songId, "not-an-email", "EDITOR"))
                        .execute(),
                "BAD_REQUEST");
    }

    @Test
    void sharingASongThatDoesNotExistIsNotFoundRatherThanForbidden() {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();

        // Same id-probing guard as everywhere else: a FORBIDDEN here would
        // confirm to an attacker that the id is real. SongAccess lets missing
        // ids through so the SERVICE answers NOT_FOUND.
        expectSingleError(
                graphQl(alice.token())
                        .document(SHARE)
                        .variable("input", shareInput(UUID.randomUUID(), bob.user().email(), "EDITOR"))
                        .execute(),
                "NOT_FOUND");
    }

    // ---- the collaborators list is batch-resolved --------------------------

    @Test
    void collaboratorsResolveForEverySongOnThePageIncludingEmptyOnes() {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID shared = createSong(alice, "Has A Guest");
        createSong(alice, "Has Nobody");
        shareWith(alice, shared, bob, "VIEWER");

        // The DataLoader must return a value for EVERY key it was handed.
        // `collaborators: [Collaborator!]!` is non-null, so a song missing
        // from the batch result would null out the entire Song object.
        List<Map<String, Object>> songs = graphQl(alice.token())
                .document(MY_LIBRARY)
                .execute()
                .path("songs").entityList(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {})
                .get();

        assertThat(songs).hasSize(2);
        assertThat(songs).allSatisfy(song -> assertThat(song.get("collaborators")).isNotNull());
        assertThat(songs).anySatisfy(song ->
                assertThat((List<?>) song.get("collaborators")).isEmpty());
        assertThat(songs).anySatisfy(song ->
                assertThat((List<?>) song.get("collaborators")).hasSize(1));
    }

    // ---- helpers -----------------------------------------------------------

    private UUID createSong(AuthPayload owner, String title) {
        return graphQl(owner.token())
                .document(CREATE_SONG)
                .variable("input", songInput(title))
                .execute()
                .path("createSong.id").entity(UUID.class).get();
    }

    private void shareWith(AuthPayload owner, UUID songId, AuthPayload invitee, String role) {
        graphQl(owner.token())
                .document(SHARE)
                .variable("input", shareInput(songId, invitee.user().email(), role))
                .execute()
                .path("shareSong.role").entity(String.class).isEqualTo(role);
    }

    private static Map<String, Object> songInput(String title) {
        return Map.of("title", title, "bpm", 120, "timeSignature", "4/4");
    }

    private static Map<String, Object> shareInput(UUID songId, String email, String role) {
        return Map.of("songId", songId.toString(), "email", email, "role", role);
    }
}
