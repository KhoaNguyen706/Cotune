package com.cotune.history;

import com.cotune.track.Step;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The fold that IS the restore feature: a lane at any moment equals its
 * events replayed from empty. Pure input → output, no Spring — if this
 * holds, trackPatternAt is just "query, fold, return".
 */
class SongHistoryReplayTest {

    private final UUID songId = UUID.randomUUID();
    private final UUID trackId = UUID.randomUUID();
    private final UUID actor = UUID.randomUUID();

    private SongEvent add(int step, String pitch) {
        return new SongEvent(songId, trackId, actor, SongEventType.NOTE_ADD,
                List.of(new Step(step, pitch, 0.9, 1)));
    }

    private SongEvent remove(int step, String pitch) {
        return new SongEvent(songId, trackId, actor, SongEventType.NOTE_REMOVE,
                List.of(new Step(step, pitch, 0.9, 1)));
    }

    private SongEvent set(Step... notes) {
        return new SongEvent(songId, trackId, actor, SongEventType.PATTERN_SET, List.of(notes));
    }

    @Test
    void aLaneIsBornEmptyAndAddsAccumulate() {
        assertThat(SongHistoryServiceImpl.replay(List.of())).isEmpty();

        List<Step> state = SongHistoryServiceImpl.replay(List.of(
                add(0, "C2"), add(4, "E2")));
        assertThat(state).extracting(Step::pitch).containsExactlyInAnyOrder("C2", "E2");
    }

    @Test
    void addUpsertsByStepAndPitchExactlyLikeTheLiveMerge() {
        // Same key twice: the second wins, no duplicate — mirroring
        // applyNote, so a replayed lane is always saveable.
        List<Step> state = SongHistoryServiceImpl.replay(List.of(
                add(0, "C2"),
                new SongEvent(songId, trackId, actor, SongEventType.NOTE_ADD,
                        List.of(new Step(0, "C2", 0.4, 3)))));

        assertThat(state).singleElement().satisfies(note -> {
            assertThat(note.velocity()).isEqualTo(0.4);
            assertThat(note.length()).isEqualTo(3);
        });
    }

    @Test
    void removeDeletesOnlyTheNoteItNames() {
        List<Step> state = SongHistoryServiceImpl.replay(List.of(
                add(0, "C2"), add(4, "E2"), remove(0, "C2")));

        assertThat(state).extracting(Step::pitch).containsExactly("E2");
    }

    @Test
    void patternSetReplacesEverythingBeforeIt() {
        // The baseline case and the HTTP-save case are the same fold step:
        // whatever came before stops mattering.
        List<Step> state = SongHistoryServiceImpl.replay(List.of(
                add(0, "C2"), add(4, "E2"),
                set(new Step(8, "G2", 0.9, 1)),
                add(12, "B2")));

        assertThat(state).extracting(Step::pitch).containsExactlyInAnyOrder("G2", "B2");
    }
}
