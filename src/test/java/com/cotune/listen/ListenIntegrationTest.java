package com.cotune.listen;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Public listen links, end to end: the ONE unauthenticated read in the API.
 *
 * What only an integration test can prove here: that `listen` really works
 * with NO Authorization header (a @WithMockUser test can't fail that), that
 * the public audio route is reachable through the real security filter
 * chain while its sibling /api/audio stays locked, and that revocation is
 * effective on the very next request.
 */
class ListenIntegrationTest extends AbstractIntegrationTest {

    private static final String CREATE_SONG = """
            mutation Create($input: CreateSongInput!) {
                createSong(input: $input) { id }
            }""";

    private static final String ENABLE = """
            mutation Enable($songId: ID!) { enableListenLink(songId: $songId) }""";

    private static final String DISABLE = """
            mutation Disable($songId: ID!) { disableListenLink(songId: $songId) }""";

    private static final String SHARE = """
            mutation Share($input: ShareSongInput!) {
                shareSong(input: $input) { userId }
            }""";

    private static final String LISTEN = """
            query Listen($token: String!) {
                listen(token: $token) {
                    title bpm timeSignature
                    beats { id name bars tracks { id instrument pattern { step pitch } } }
                    clips { id type beatId audioId }
                    audioFiles { id contentType durationSeconds }
                }
            }""";

    private static final String LIBRARY_TOKENS = """
            query Library { songs { id listenToken } }""";

    // ---- the public read ----------------------------------------------------

    @Test
    void anonymousStrangerHearsTheSongThroughTheLink() {
        AuthPayload owner = registerFreshUser();
        UUID songId = createSong(owner, "Night Drive");

        String token = enable(owner, songId);
        assertThat(token).hasSize(43); // 32 random bytes, base64url, no padding

        // NO Authorization header anywhere in this request.
        anonymousGraphQl().document(LISTEN).variable("token", token).execute()
                .path("listen.title").entity(String.class).isEqualTo("Night Drive")
                .path("listen.bpm").entity(Integer.class).isEqualTo(120)
                .path("listen.timeSignature").entity(String.class).isEqualTo("4/4");
    }

    @Test
    void enablingTwiceKeepsTheSameLinkAliveButRevokeThenEnableMintsAFreshOne() {
        AuthPayload owner = registerFreshUser();
        UUID songId = createSong(owner, "Stable Link");

        String first = enable(owner, songId);
        // Idempotent: a re-opened share sheet must not silently kill the
        // link already pasted into a group chat.
        assertThat(enable(owner, songId)).isEqualTo(first);

        graphQl(owner.token()).document(DISABLE).variable("songId", songId).execute()
                .path("disableListenLink").entity(Boolean.class).isEqualTo(true);

        // The old link is dead on the very next request...
        expectSingleError(
                anonymousGraphQl().document(LISTEN).variable("token", first).execute(),
                "NOT_FOUND");

        // ...and re-enabling mints a FRESH token, so the leaked old link
        // stays dead forever.
        String second = enable(owner, songId);
        assertThat(second).isNotEqualTo(first);
    }

    @Test
    void aGuessedTokenIsNotFound() {
        expectSingleError(
                anonymousGraphQl().document(LISTEN).variable("token", "no-such-token").execute(),
                "NOT_FOUND");
    }

    // ---- who may publish -----------------------------------------------------

    @Test
    void onlyTheOwnerMayCreateOrRevokeTheLink() {
        AuthPayload owner = registerFreshUser();
        AuthPayload editor = registerFreshUser();
        AuthPayload stranger = registerFreshUser();
        UUID songId = createSong(owner, "Owner's Call");
        graphQl(owner.token()).document(SHARE)
                .variable("input", Map.of("songId", songId.toString(),
                        "email", editor.user().email(), "role", "EDITOR"))
                .execute().path("shareSong.userId").hasValue();

        // Publishing decides WHO GETS IN — the same power sharing is, and it
        // stops at the same place: an EDITOR can change the music, not the
        // audience.
        expectSingleError(
                graphQl(editor.token()).document(ENABLE).variable("songId", songId).execute(),
                "FORBIDDEN");
        expectSingleError(
                graphQl(stranger.token()).document(ENABLE).variable("songId", songId).execute(),
                "FORBIDDEN");
        expectSingleError(
                anonymousGraphQl().document(ENABLE).variable("songId", songId).execute(),
                "UNAUTHORIZED");

        String token = enable(owner, songId);
        expectSingleError(
                graphQl(editor.token()).document(DISABLE).variable("songId", songId).execute(),
                "FORBIDDEN");

        // The failed attempts changed nothing: the link still works.
        anonymousGraphQl().document(LISTEN).variable("token", token).execute()
                .path("listen.title").entity(String.class).isEqualTo("Owner's Call");
    }

    @Test
    void theTokenItselfIsVisibleOnlyToTheOwner() {
        AuthPayload owner = registerFreshUser();
        AuthPayload editor = registerFreshUser();
        UUID songId = createSong(owner, "Secret Address");
        graphQl(owner.token()).document(SHARE)
                .variable("input", Map.of("songId", songId.toString(),
                        "email", editor.user().email(), "role", "EDITOR"))
                .execute().path("shareSong.userId").hasValue();
        String token = enable(owner, songId);

        graphQl(owner.token()).document(LIBRARY_TOKENS).execute()
                .path("songs[0].listenToken").entity(String.class).isEqualTo(token);

        // The editor sees the SONG in their library but reads null for the
        // token — they hold view/edit rights, not publishing rights, and a
        // token they could read is a token they could leak-and-outlive.
        graphQl(editor.token()).document(LIBRARY_TOKENS).execute()
                .path("songs[0].listenToken").valueIsNull();
    }

    // ---- the public audio bytes route -----------------------------------------

    @Test
    void audioBytesFlowThroughTheTokenRouteAndOnlyThroughIt() {
        AuthPayload owner = registerFreshUser();
        UUID songId = createSong(owner, "With Vocals");
        UUID audioId = uploadAudio(owner, songId);
        String token = enable(owner, songId);

        // Anonymous, through the token route: 200 with the exact bytes.
        ResponseEntity<byte[]> ok = rest.getForEntity(
                "/api/listen/%s/audio/%s".formatted(token, audioId), byte[].class);
        assertThat(ok.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(ok.getBody()).isEqualTo(FAKE_MP3);

        // The same bytes on the MEMBER route stay locked to members —
        // the public route is an addition, not a hole in the old one.
        assertThat(rest.getForEntity("/api/audio/" + audioId, byte[].class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        // A valid token for SONG A must not fetch song B's uploads.
        UUID otherSong = createSong(owner, "Other Song");
        UUID otherAudio = uploadAudio(owner, otherSong);
        assertThat(rest.getForEntity(
                "/api/listen/%s/audio/%s".formatted(token, otherAudio), byte[].class)
                .getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        // Revoke: the bytes route dies with the link.
        graphQl(owner.token()).document(DISABLE).variable("songId", songId).execute()
                .path("disableListenLink").entity(Boolean.class).isEqualTo(true);
        assertThat(rest.getForEntity(
                "/api/listen/%s/audio/%s".formatted(token, audioId), byte[].class)
                .getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ---- helpers ---------------------------------------------------------------

    private static final byte[] FAKE_MP3 = "not-really-mp3-but-the-server-never-decodes".getBytes();

    private UUID createSong(AuthPayload owner, String title) {
        return graphQl(owner.token())
                .document(CREATE_SONG)
                .variable("input", Map.of("title", title, "bpm", 120, "timeSignature", "4/4"))
                .execute()
                .path("createSong.id").entity(UUID.class).get();
    }

    private String enable(AuthPayload owner, UUID songId) {
        return graphQl(owner.token())
                .document(ENABLE)
                .variable("songId", songId)
                .execute()
                .path("enableListenLink").entity(String.class).get();
    }

    /** Real multipart through the real endpoint — the server stores bytes
     *  verbatim (the browser is the thing that decodes audio). */
    private UUID uploadAudio(AuthPayload owner, UUID songId) {
        HttpHeaders fileHeaders = new HttpHeaders();
        fileHeaders.setContentType(MediaType.parseMediaType("audio/mpeg"));
        HttpEntity<ByteArrayResource> filePart = new HttpEntity<>(new ByteArrayResource(FAKE_MP3) {
            @Override
            public String getFilename() {
                return "vocals.mp3";
            }
        }, fileHeaders);

        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("file", filePart);
        form.add("durationSeconds", "2.5");

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(owner.token());
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/api/songs/" + songId + "/audio",
                HttpMethod.POST,
                new HttpEntity<>(form, headers),
                new org.springframework.core.ParameterizedTypeReference<>() {
                });
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        return UUID.fromString((String) response.getBody().get("id"));
    }
}
