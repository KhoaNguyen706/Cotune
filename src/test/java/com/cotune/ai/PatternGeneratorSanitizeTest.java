package com.cotune.ai;

import com.cotune.ai.PatternGenerator.GeneratedNote;
import com.cotune.track.Step;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The trust boundary, unit-tested: sanitize() is the ONLY door between
 * "whatever the model said" and the domain, so each rule gets pinned —
 * repairs where intent is clear (overrun length, over-loud velocity),
 * drops everywhere else. No Spring, no network: pure input → output.
 */
class PatternGeneratorSanitizeTest {

    private static final int SIXTEEN_STEPS = 16;

    @Test
    void validNotesSurviveUntouched() {
        List<Step> notes = PatternGenerator.sanitize(List.of(
                new GeneratedNote(0, "C2", 0.9, 1),
                new GeneratedNote(8, "F#4", 0.55, 4)), SIXTEEN_STEPS);

        assertThat(notes).containsExactly(
                new Step(0, "C2", 0.9, 1),
                new Step(8, "F#4", 0.55, 4));
    }

    @Test
    void stepsOutsideTheBeatAreDropped() {
        List<Step> notes = PatternGenerator.sanitize(List.of(
                new GeneratedNote(-1, "C2", 0.9, 1),
                new GeneratedNote(16, "C2", 0.9, 1),   // a 1-bar beat ends at 15
                new GeneratedNote(15, "C2", 0.9, 1)), SIXTEEN_STEPS);

        assertThat(notes).containsExactly(new Step(15, "C2", 0.9, 1));
    }

    @Test
    void aLengthThatOverrunsTheBeatIsTrimmedToFit() {
        // The start is musical intent; the overhang is the model forgetting
        // the bar count. Trim, don't drop.
        List<Step> notes = PatternGenerator.sanitize(List.of(
                new GeneratedNote(12, "C3", 0.8, 10),
                new GeneratedNote(0, "C3", 0.8, 0)),   // and non-positive -> 1
                SIXTEEN_STEPS);

        assertThat(notes).containsExactly(
                new Step(12, "C3", 0.8, 4),
                new Step(0, "C3", 0.8, 1));
    }

    @Test
    void velocityAboveOneIsClampedAndNonPositiveIsDropped() {
        List<Step> notes = PatternGenerator.sanitize(List.of(
                new GeneratedNote(0, "C2", 1.4, 1),    // clearly meant "loud"
                new GeneratedNote(4, "C2", 0.0, 1),    // meant nothing sayable
                new GeneratedNote(8, "C2", -0.5, 1)), SIXTEEN_STEPS);

        assertThat(notes).containsExactly(new Step(0, "C2", 1.0, 1));
    }

    @Test
    void garbagePitchesAreDropped() {
        List<Step> notes = PatternGenerator.sanitize(List.of(
                new GeneratedNote(0, "H9", 0.9, 1),
                new GeneratedNote(1, "kick", 0.9, 1),
                new GeneratedNote(2, null, 0.9, 1),
                new GeneratedNote(3, "A#3", 0.9, 1)), SIXTEEN_STEPS);

        assertThat(notes).containsExactly(new Step(3, "A#3", 0.9, 1));
    }

    @Test
    void duplicateStepAndPitchKeepsTheFirst() {
        // The pattern save rejects duplicates outright; sanitize must never
        // hand the client a pattern the server would then refuse to keep.
        List<Step> notes = PatternGenerator.sanitize(List.of(
                new GeneratedNote(0, "C2", 0.9, 1),
                new GeneratedNote(0, "C2", 0.4, 2),
                new GeneratedNote(0, "E2", 0.4, 1)), SIXTEEN_STEPS);

        assertThat(notes).containsExactly(
                new Step(0, "C2", 0.9, 1),
                new Step(0, "E2", 0.4, 1));
    }

    @Test
    void aRunawayResponseIsTruncatedAtTheCap() {
        // 8 bars x 16 steps x 3 pitches = 384 candidate notes, all valid.
        int totalSteps = 128;
        List<GeneratedNote> flood = IntStream.range(0, totalSteps)
                .boxed()
                .flatMap(step -> List.of("C2", "E2", "G2").stream()
                        .map(pitch -> new GeneratedNote(step, pitch, 0.9, 1)))
                .toList();

        assertThat(PatternGenerator.sanitize(flood, totalSteps))
                .hasSize(PatternGenerator.MAX_NOTES);
    }
}
