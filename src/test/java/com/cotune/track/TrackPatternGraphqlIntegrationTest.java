package com.cotune.track;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.testsupport.AbstractIntegrationTest;
import com.cotune.track.dto.StepDto;
import org.junit.jupiter.api.Test;
import org.springframework.graphql.test.tester.GraphQlTester;
import org.springframework.graphql.test.tester.HttpGraphQlTester;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * This test is WHY the suite runs on Testcontainers instead of H2. The
 * pattern column is Postgres JSONB (@JdbcTypeCode(SqlTypes.JSON) on
 * Track.pattern): Hibernate serializes List<Step> through Jackson into a
 * dialect-specific column type that H2 does not have — an in-memory-DB
 * suite would either fail to boot Flyway's `jsonb` DDL or paper over it
 * with a compatibility mode that behaves differently on writes. The
 * optimistic-lock path is DB-real too: the CONFLICT below comes from an
 * actual version comparison on an actual row.
 */
class TrackPatternGraphqlIntegrationTest extends AbstractIntegrationTest {

    private static final String UPDATE_PATTERN = """
            mutation UpdatePattern($id: ID!, $pattern: [StepInput!]!, $expectedVersion: Int) {
                updateTrackPattern(id: $id, pattern: $pattern, expectedVersion: $expectedVersion) {
                    id
                    version
                    pattern { step pitch velocity length }
                }
            }""";

    @Test
    void patternRoundTripsThroughRealJsonbAndStaleWritesConflict() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester graphQl = graphQl(owner.token());
        SongTrackIds ids = createSongBeatAndTrack(graphQl);
        UUID trackId = ids.trackId();

        List<Map<String, Object>> pattern = List.of(
                Map.of("step", 0, "pitch", "C4", "velocity", 0.9, "length", 2),
                // No "length": exercises the schema default (length: Int! = 1),
                // i.e. the request an older client would send.
                Map.of("step", 4, "pitch", "F#2", "velocity", 0.55));

        // expectedVersion 0 = "I last saw the freshly created track".
        GraphQlTester.Response saved = graphQl.document(UPDATE_PATTERN)
                .variable("id", trackId)
                .variable("pattern", pattern)
                .variable("expectedVersion", 0)
                .execute();

        saved.path("updateTrackPattern.version").entity(Integer.class).isEqualTo(1);
        List<StepDto> steps = saved.path("updateTrackPattern.pattern")
                .entityList(StepDto.class).get();
        assertThat(steps).containsExactlyInAnyOrder(
                new StepDto(0, "C4", 0.9, 2),
                new StepDto(4, "F#2", 0.55, 1)); // schema default applied

        // Fresh request → fresh transaction → the JSONB value read back
        // from disk, not from any cache: serialize AND deserialize both
        // crossed the real column type.
        graphQl.document("""
                        query Track($id: ID!) {
                            song(id: $id) {
                                beats { tracks { pattern { step pitch velocity length } } }
                            }
                        }""")
                .variable("id", ids.songId())
                .execute()
                .path("song.beats[0].tracks[0].pattern")
                .entityList(StepDto.class)
                .satisfies(persisted -> assertThat(persisted).hasSize(2));

        // Now replay the SAME expectedVersion 0. The row is at version 1 —
        // this models editor B saving over editor A's grid. CONFLICT, and
        // crucially: the pattern must be A's, untouched (no lost update).
        GraphQlTester.Response stale = graphQl.document(UPDATE_PATTERN)
                .variable("id", trackId)
                .variable("pattern", List.of())
                .variable("expectedVersion", 0)
                .execute();
        expectSingleError(stale, "CONFLICT");
    }

    @Test
    void malformedPitchIsBadRequestWithAHelpfulMessage() {
        AuthPayload owner = registerFreshUser();
        HttpGraphQlTester graphQl = graphQl(owner.token());
        UUID trackId = createSongBeatAndTrack(graphQl).trackId();

        GraphQlTester.Response response = graphQl.document(UPDATE_PATTERN)
                .variable("id", trackId)
                .variable("pattern", List.of(
                        // "H9" passes GraphQL's type check (it's a String) —
                        // only Bean Validation on StepInput can reject it.
                        Map.of("step", 0, "pitch", "H9", "velocity", 0.9)))
                .execute();

        // Without the ConstraintViolationException branch in
        // GraphqlExceptionResolver this arrives as INTERNAL_ERROR with the
        // message stripped — the exact regression this test pins down.
        response.errors().satisfy(errors -> {
            assertThat(errors).hasSize(1);
            assertThat(errors.getFirst().getExtensions().get("classification"))
                    .isEqualTo("BAD_REQUEST");
            assertThat(errors.getFirst().getMessage()).contains("pitch");
        });
    }

    /** The two ids later steps need: the track to edit, the song to re-read. */
    private record SongTrackIds(UUID songId, UUID trackId) {
    }

    /** Songs contain beats contain tracks — build the whole chain via the API. */
    private SongTrackIds createSongBeatAndTrack(HttpGraphQlTester graphQl) {
        UUID songId = graphQl.document("""
                        mutation Create($input: CreateSongInput!) {
                            createSong(input: $input) { id }
                        }""")
                .variable("input", Map.of("title", "Pattern Host", "bpm", 128, "timeSignature", "4/4"))
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
                            addTrack(input: $input) { id version }
                        }""")
                .variable("input", Map.of("beatId", beatId, "name", "Kick", "instrument", "DRUMS"))
                .execute()
                .path("addTrack.id").entity(UUID.class).get();

        return new SongTrackIds(songId, trackId);
    }
}
