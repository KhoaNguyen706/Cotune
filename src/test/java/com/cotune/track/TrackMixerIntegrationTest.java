package com.cotune.track;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.graphql.test.tester.HttpGraphQlTester;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Mixer persistence (V14) end to end: the mix survives the full loop —
 * PATCH over real HTTP, real columns via Flyway's migration, read back by
 * the editor's GraphQL query AND by the public listen surface. The point
 * of the feature is "your collaborator (and your listener) hears your
 * mix", and only the re-reads prove that.
 */
class TrackMixerIntegrationTest extends AbstractIntegrationTest {

    @Test
    void mixRoundTripsAndTheListenLinkCarriesIt() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester graphQl = graphQl(owner.token());
        Ids ids = createSongBeatAndTrack(graphQl);

        // Fresh lanes sound exactly like before V14: unity gain, centered.
        Map<String, Object> track = readTrack(graphQl, ids.songId());
        assertThat(track.get("volume")).isEqualTo(1.0);
        assertThat(track.get("pan")).isEqualTo(0.0);

        // One PATCH per slider release — both fields in one body works too.
        assertThat(patchTrack(owner.token(), ids.trackId(), Map.of("volume", 0.4, "pan", -0.25)))
                .isEqualTo(HttpStatus.OK);

        // Fresh request, fresh transaction: the values crossed the real
        // columns, not a cache.
        track = readTrack(graphQl, ids.songId());
        assertThat(track.get("volume")).isEqualTo(0.4);
        assertThat(track.get("pan")).isEqualTo(-0.25);

        // The public player hears the same balance the makers set. This is
        // also the pin on ListenTrack's new fields — a regression here means
        // shared songs silently play unmixed.
        String token = graphQl.document("""
                        mutation Enable($songId: ID!) { enableListenLink(songId: $songId) }""")
                .variable("songId", ids.songId())
                .execute()
                .path("enableListenLink").entity(String.class).get();
        anonymousGraphQl().document("""
                        query Listen($token: String!) {
                            listen(token: $token) {
                                beats { tracks { volume pan } }
                            }
                        }""")
                .variable("token", token)
                .execute()
                .path("listen.beats[0].tracks[0].volume").entity(Double.class).isEqualTo(0.4)
                .path("listen.beats[0].tracks[0].pan").entity(Double.class).isEqualTo(-0.25);
    }

    @Test
    void outOfRangeValuesAndEmptyPatchesAreRejected() {
        AuthPayload owner = registerFreshUser();
        Ids ids = createSongBeatAndTrack(graphQl(owner.token()));

        // The domain rules fire, not a 500: volume beyond unity and pan
        // beyond the stereo field mean a buggy or hostile client.
        assertThat(patchTrack(owner.token(), ids.trackId(), Map.of("volume", 1.5)))
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(patchTrack(owner.token(), ids.trackId(), Map.of("volume", -0.1)))
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(patchTrack(owner.token(), ids.trackId(), Map.of("pan", 2)))
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(patchTrack(owner.token(), ids.trackId(), Map.of()))
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void onlyEditorsMayTouchTheMix() {
        AuthPayload owner = registerFreshUser();
        AuthPayload stranger = registerFreshUser();
        Ids ids = createSongBeatAndTrack(graphQl(owner.token()));

        assertThat(patchTrack(stranger.token(), ids.trackId(), Map.of("volume", 0.1)))
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    // ---- plumbing ----------------------------------------------------------

    private record Ids(UUID songId, UUID trackId) {
    }

    /** WebTestClient, not TestRestTemplate: the JDK's HttpURLConnection
     *  cannot send PATCH at all — the exact reason no REST PATCH test
     *  existed before this one. Returns just the status; bodies are
     *  asserted through the GraphQL re-read, where clients actually look. */
    private org.springframework.http.HttpStatusCode patchTrack(
            String token, UUID trackId, Map<String, Object> body) {
        return WebTestClient.bindToServer()
                .baseUrl("http://localhost:" + port)
                .build()
                .patch().uri("/api/tracks/" + trackId)
                .headers(headers -> headers.setBearerAuth(token))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .returnResult(String.class)
                .getStatus();
    }

    /** The one lane's fields, read back through the editor's query. */
    private Map<String, Object> readTrack(HttpGraphQlTester graphQl, UUID songId) {
        return graphQl.document("""
                        query Song($id: ID!) {
                            song(id: $id) { beats { tracks { volume pan } } }
                        }""")
                .variable("id", songId)
                .execute()
                .path("song.beats[0].tracks[0]")
                .entity(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
                })
                .get();
    }

    private Ids createSongBeatAndTrack(HttpGraphQlTester graphQl) {
        UUID songId = graphQl.document("""
                        mutation Create($input: CreateSongInput!) {
                            createSong(input: $input) { id }
                        }""")
                .variable("input", Map.of("title", "Mix Host", "bpm", 120, "timeSignature", "4/4"))
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
        return new Ids(songId, trackId);
    }
}
