package com.cotune.history;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import com.cotune.track.NoteOpType;
import com.cotune.track.TrackService;
import com.cotune.track.dto.NoteOp;
import com.cotune.track.dto.StepDto;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.graphql.test.tester.HttpGraphQlTester;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Version history end to end: edits WRITE it, the panel's query READS it
 * with names resolved, and replay actually reconstructs an older grid.
 * The delta path is exercised through the same TrackService method the
 * socket handler calls — the STOMP transport itself is pinned by the
 * realtime suite; what matters here is that BOTH write paths log.
 */
class SongHistoryIntegrationTest extends AbstractIntegrationTest {

    private static final String HISTORY = """
            query History($songId: ID!) {
                songHistory(songId: $songId) {
                    id trackId trackName actorName type summary createdAt
                }
            }""";

    private static final String PATTERN_AT = """
            query At($trackId: ID!, $eventId: ID!) {
                trackPatternAt(trackId: $trackId, eventId: $eventId) {
                    step pitch velocity length
                }
            }""";

    private static final String SAVE = """
            mutation Save($id: ID!, $pattern: [StepInput!]!) {
                updateTrackPattern(id: $id, pattern: $pattern) { id }
            }""";

    @Autowired
    private TrackService trackService;

    @Test
    void bothWritePathsLogAndReplayReconstructsThePast() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester graphQl = graphQl(owner.token());
        Ids ids = createSongBeatAndTrack(graphQl);

        // Write path 1 — the whole-grid HTTP save: version A of the lane.
        List<Map<String, Object>> versionA = List.of(
                Map.of("step", 0, "pitch", "C2", "velocity", 0.9, "length", 1),
                Map.of("step", 8, "pitch", "E2", "velocity", 0.7, "length", 2));
        graphQl.document(SAVE).variable("id", ids.trackId())
                .variable("pattern", versionA).execute().path("updateTrackPattern.id").hasValue();

        // Write path 2 — deltas, through the same service method the
        // socket handler calls: kill C2, add G2.
        UUID actor = owner.user().id();
        trackService.applyNote(ids.songId(), ids.trackId(),
                new NoteOp(NoteOpType.REMOVE, ids.trackId(), 0, "C2", 0, 0), actor);
        trackService.applyNote(ids.songId(), ids.trackId(),
                new NoteOp(NoteOpType.ADD, ids.trackId(), 12, "G2", 0.8, 1), actor);

        // The log, newest first, names resolved, human summaries.
        List<Map<String, Object>> events = graphQl.document(HISTORY)
                .variable("songId", ids.songId()).execute()
                .path("songHistory")
                .entityList(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
                })
                .get();
        assertThat(events).hasSize(3);
        assertThat(events.getFirst().get("type")).isEqualTo("NOTE_ADD");
        assertThat(events.getFirst().get("summary")).isEqualTo("added G2 at step 12");
        assertThat(events.get(1).get("type")).isEqualTo("NOTE_REMOVE");
        // The remove op carried no velocity; history recorded the note AS
        // IT WAS — proven by the summary knowing its pitch and position.
        assertThat(events.get(1).get("summary")).isEqualTo("removed C2 from step 0");
        assertThat(events.get(2).get("type")).isEqualTo("PATTERN_SET");
        assertThat(events).allSatisfy(event -> {
            assertThat(event.get("actorName")).isEqualTo("Integration Tester");
            assertThat(event.get("trackName")).isEqualTo("Kick");
        });

        // REPLAY: the lane as of the PATTERN_SET is version A exactly —
        // the two deltas that came after don't exist yet at that moment.
        String saveEventId = (String) events.get(2).get("id");
        List<StepDto> restored = graphQl.document(PATTERN_AT)
                .variable("trackId", ids.trackId()).variable("eventId", saveEventId)
                .execute()
                .path("trackPatternAt").entityList(StepDto.class).get();
        assertThat(restored).containsExactlyInAnyOrder(
                new StepDto(0, "C2", 0.9, 1),
                new StepDto(8, "E2", 0.7, 2));
    }

    @Test
    void strangersAreRefusedAndViewersMayLook() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester ownerGraphQl = graphQl(owner.token());
        Ids ids = createSongBeatAndTrack(ownerGraphQl);

        AuthPayload stranger = registerFreshUser();
        expectSingleError(
                graphQl(stranger.token()).document(HISTORY)
                        .variable("songId", ids.songId()).execute(),
                "FORBIDDEN");
        expectSingleError(
                graphQl(stranger.token()).document(PATTERN_AT)
                        .variable("trackId", ids.trackId()).variable("eventId", "1").execute(),
                "FORBIDDEN");

        // A VIEWER is in the room: reading history is reading the song.
        AuthPayload viewer = registerFreshUser();
        ownerGraphQl.document("""
                        mutation Share($input: ShareSongInput!) {
                            shareSong(input: $input) { userId }
                        }""")
                .variable("input", Map.of(
                        "songId", ids.songId(), "email", viewer.user().email(), "role", "VIEWER"))
                .execute()
                .path("shareSong.userId").hasValue();
        graphQl(viewer.token()).document(HISTORY)
                .variable("songId", ids.songId()).execute()
                .path("songHistory").hasValue();
    }

    @Test
    void aDeletedLanesEventsSurviveWithoutAName() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester graphQl = graphQl(owner.token());
        Ids ids = createSongBeatAndTrack(graphQl);

        graphQl.document(SAVE).variable("id", ids.trackId())
                .variable("pattern", List.of(
                        Map.of("step", 0, "pitch", "C2", "velocity", 0.9, "length", 1)))
                .execute().path("updateTrackPattern.id").hasValue();
        graphQl.document("mutation Del($id: ID!) { deleteTrack(id: $id) }")
                .variable("id", ids.trackId()).execute()
                .path("deleteTrack").entity(Boolean.class).isEqualTo(true);

        // The lane is gone; the record of what happened in it is not —
        // that answer ("it WAS deleted") is the point of the feature. The
        // null trackName is what tells clients "not restorable".
        List<Map<String, Object>> events = graphQl.document(HISTORY)
                .variable("songId", ids.songId()).execute()
                .path("songHistory")
                .entityList(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
                })
                .get();
        assertThat(events).hasSize(1);
        assertThat(events.getFirst().get("trackName")).isNull();
    }

    // ---- plumbing ----------------------------------------------------------

    private record Ids(UUID songId, UUID trackId) {
    }

    private Ids createSongBeatAndTrack(HttpGraphQlTester graphQl) {
        UUID songId = graphQl.document("""
                        mutation Create($input: CreateSongInput!) {
                            createSong(input: $input) { id }
                        }""")
                .variable("input", Map.of("title", "History Host", "bpm", 100, "timeSignature", "4/4"))
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
