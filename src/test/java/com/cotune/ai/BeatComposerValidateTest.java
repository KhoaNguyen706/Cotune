package com.cotune.ai;

import com.cotune.ai.GeminiClient.FunctionCall;
import com.cotune.song.Song;
import com.cotune.track.Instrument;
import com.cotune.track.Step;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The trust boundary, unit-tested — the same job
 * PatternGeneratorSanitizeTest does for one lane, one level up. validate()
 * is the ONLY door between "whatever tools the model asked for" and a plan
 * the client will apply, so each rule gets pinned. No Spring, no network:
 * FunctionCalls in, AiActions out.
 *
 * The calls here are deliberately the ones a model actually emits — a
 * schema-valid BPM of 900, "Kick" then "kick", a pattern for a lane nobody
 * created — not hypothetical garbage. Gemini's schema constrains SHAPE;
 * every one of these is shape-valid and still wrong.
 */
class BeatComposerValidateTest {

    private static final int SIXTEEN_STEPS = 16;

    /** An empty beat — no lanes yet, the common "compose me something" case. */
    private static BeatComposer.BeatContext emptyBeat() {
        return new BeatComposer.BeatContext(
                UUID.randomUUID(), "Beat 1", SIXTEEN_STEPS, List.of(), Set.of());
    }

    private static BeatComposer.BeatContext beatWithLanes(String... lanes) {
        return new BeatComposer.BeatContext(
                UUID.randomUUID(), "Beat 1", SIXTEEN_STEPS,
                List.of(lanes), new LinkedHashSet<>(List.of(lanes)));
    }

    /** validate() needs no collaborators — the DB fields are never touched. */
    private static BeatComposer composer() {
        return new BeatComposer(null, null, null);
    }

    private static FunctionCall call(String name, Map<String, Object> args) {
        return new FunctionCall(name, args);
    }

    @Test
    void aWholeBeatSurvivesInOrder() {
        List<AiAction> plan = composer().validate(List.of(
                call("set_bpm", Map.of("bpm", 72)),
                call("add_lane", Map.of("lane", "kick", "instrument", "DRUMS")),
                call("set_lane_pattern", Map.of("lane", "kick", "notes", List.of(
                        Map.of("step", 0, "pitch", "C2", "velocity", 0.9, "length", 1),
                        Map.of("step", 8, "pitch", "C2", "velocity", 0.7, "length", 1))))),
                emptyBeat());

        assertThat(plan).containsExactly(
                new AiAction.SetBpm(72),
                new AiAction.AddLane("kick", Instrument.DRUMS),
                new AiAction.SetLanePattern("kick", List.of(
                        new Step(0, "C2", 0.9, 1),
                        new Step(8, "C2", 0.7, 1))));
    }

    @Test
    void aBpmOutsideSongsBoundsIsDroppedButTheRestOfThePlanLives() {
        List<AiAction> plan = composer().validate(List.of(
                call("set_bpm", Map.of("bpm", 900)),
                call("set_bpm", Map.of("bpm", Song.MIN_BPM - 1)),
                call("add_lane", Map.of("lane", "keys", "instrument", "PIANO"))),
                emptyBeat());

        // One bad call costs one action, never the whole request.
        assertThat(plan).containsExactly(new AiAction.AddLane("keys", Instrument.PIANO));
    }

    @Test
    void anInstrumentThatIsNotInTheEnumIsDropped() {
        // "SAD" is a mood, not an Instrument — and an `enum` in the tool
        // schema does not stop the model from saying it.
        List<AiAction> plan = composer().validate(List.of(
                call("add_lane", Map.of("lane", "sad", "instrument", "SAD"))),
                emptyBeat());

        assertThat(plan).isEmpty();
    }

    @Test
    void addLaneIsCaseInsensitiveAgainstLanesTheBeatAlreadyHas() {
        // Adding a second "kick" would give the user two lanes with one name
        // and a pattern that lands in a coin-flip one of them.
        List<AiAction> plan = composer().validate(List.of(
                call("add_lane", Map.of("lane", "Kick", "instrument", "DRUMS"))),
                beatWithLanes("kick"));

        assertThat(plan).isEmpty();
    }

    @Test
    void aPatternForALaneAddedEarlierInTheSamePlanIsKept() {
        // The lane does not exist in the beat YET — add_lane above is going
        // to create it. Case differs, as the model routinely does.
        List<AiAction> plan = composer().validate(List.of(
                call("add_lane", Map.of("lane", "Bass", "instrument", "BASS")),
                call("set_lane_pattern", Map.of("lane", "bass", "notes", List.of(
                        Map.of("step", 0, "pitch", "C1", "velocity", 0.8, "length", 4))))),
                emptyBeat());

        assertThat(plan).containsExactly(
                new AiAction.AddLane("Bass", Instrument.BASS),
                new AiAction.SetLanePattern("bass", List.of(new Step(0, "C1", 0.8, 4))));
    }

    @Test
    void aPatternForALaneNobodyEverCreatedIsDropped() {
        List<AiAction> plan = composer().validate(List.of(
                call("set_lane_pattern", Map.of("lane", "ghost", "notes", List.of(
                        Map.of("step", 0, "pitch", "C2", "velocity", 0.8, "length", 1))))),
                emptyBeat());

        // Silently landing nowhere would be the alternative.
        assertThat(plan).isEmpty();
    }

    @Test
    void theFirstPatternForALaneWins() {
        List<AiAction> plan = composer().validate(List.of(
                call("set_lane_pattern", Map.of("lane", "kick", "notes", List.of(
                        Map.of("step", 0, "pitch", "C2", "velocity", 0.9, "length", 1)))),
                call("set_lane_pattern", Map.of("lane", "KICK", "notes", List.of(
                        Map.of("step", 4, "pitch", "C2", "velocity", 0.9, "length", 1))))),
                beatWithLanes("kick"));

        assertThat(plan).containsExactly(
                new AiAction.SetLanePattern("kick", List.of(new Step(0, "C2", 0.9, 1))));
    }

    @Test
    void notesGoThroughTheSameSanitizerAsAGeneratedPattern() {
        List<AiAction> plan = composer().validate(List.of(
                call("set_lane_pattern", Map.of("lane", "kick", "notes", List.of(
                        Map.of("step", 99, "pitch", "C2", "velocity", 0.9, "length", 1),   // past the beat
                        Map.of("step", 0, "pitch", "H9", "velocity", 0.9, "length", 1),    // not a pitch
                        Map.of("step", 4, "pitch", "C2", "velocity", 3.0, "length", 1),    // clamped to 1.0
                        Map.of("step", 12, "pitch", "C2", "velocity", 0.8, "length", 99))))), // trimmed to fit
                beatWithLanes("kick"));

        assertThat(plan).containsExactly(
                new AiAction.SetLanePattern("kick", List.of(
                        new Step(4, "C2", 1.0, 1),
                        new Step(12, "C2", 0.8, 4))));
    }

    @Test
    void aLaneWhoseNotesAllDieProducesNoActionAtAll() {
        // An empty SetLanePattern would CLEAR the lane — the opposite of
        // what a model asking for notes intended.
        List<AiAction> plan = composer().validate(List.of(
                call("set_lane_pattern", Map.of("lane", "kick", "notes", List.of(
                        Map.of("step", 99, "pitch", "C2", "velocity", 0.9, "length", 1))))),
                beatWithLanes("kick"));

        assertThat(plan).isEmpty();
    }

    @Test
    void anUnknownToolIsIgnoredRatherThanFatal() {
        List<AiAction> plan = composer().validate(List.of(
                call("delete_song", Map.of("songId", "everything")),
                call("set_bpm", Map.of("bpm", 90))),
                emptyBeat());

        // A tool we never declared cannot become an action no matter what
        // the model calls it.
        assertThat(plan).containsExactly(new AiAction.SetBpm(90));
    }

    @Test
    void aRunawayPlanIsTruncatedNotRejected() {
        List<FunctionCall> calls = java.util.stream.IntStream.range(0, BeatComposer.MAX_ACTIONS + 10)
                .mapToObj(i -> call("add_lane", Map.of("lane", "lane" + i, "instrument", "SYNTH")))
                .toList();

        assertThat(composer().validate(calls, emptyBeat())).hasSize(BeatComposer.MAX_ACTIONS);
    }

    @Test
    void malformedArgumentsCostOneActionNotThePlan() {
        List<AiAction> plan = composer().validate(java.util.Arrays.asList(
                call("set_bpm", Map.of("bpm", "not a number")),
                call("add_lane", Map.of("lane", "   ", "instrument", "DRUMS")),  // blank name
                call("set_lane_pattern", Map.of("lane", "kick", "notes", "not a list")),
                new FunctionCall("set_bpm", null),                                // no args at all
                call("set_bpm", Map.of("bpm", 84))),
                beatWithLanes("kick"));

        assertThat(plan).containsExactly(new AiAction.SetBpm(84));
    }

    @Test
    void aLaneNameLongerThanTheCeilingIsTruncatedNotDropped() {
        String paragraph = "x".repeat(BeatComposer.MAX_LANE_NAME + 20);
        List<AiAction> plan = composer().validate(List.of(
                call("add_lane", Map.of("lane", paragraph, "instrument", "SYNTH"))),
                emptyBeat());

        assertThat(plan).containsExactly(
                new AiAction.AddLane("x".repeat(BeatComposer.MAX_LANE_NAME), Instrument.SYNTH));
    }
}
