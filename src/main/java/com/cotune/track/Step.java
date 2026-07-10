package com.cotune.track;

import java.util.regex.Pattern;

/**
 * One note event in a track's pattern: "at step N, play PITCH this loud".
 *
 * THIS is where a beat lives — as structured, mergeable events, not audio.
 * You can diff two versions of this, replay it at any BPM, or (later) merge
 * two collaborators' edits. None of that is possible with rendered audio
 * bytes, which is why patterns go in Postgres and only actual audio files
 * (samples, exports) will go to object storage.
 *
 * A record, persisted as JSONB inside the tracks row (see Track.pattern).
 */
public record Step(int step, String pitch, double velocity) {

    /** 16 sixteenth-notes = one bar — the classic step-sequencer loop. */
    public static final int STEPS_PER_PATTERN = 16;

    // Scientific pitch notation: C4, F#2, A0... Validated at the edge so
    // the frontend can trust every stored pitch to be playable by Tone.js.
    private static final Pattern PITCH_FORMAT = Pattern.compile("^[A-G]#?[0-8]$");

    // Compact constructor: it is impossible to hold an invalid Step in
    // memory — same philosophy as the entity constructors, applied to a
    // value object.
    public Step {
        if (step < 0 || step >= STEPS_PER_PATTERN) {
            throw new IllegalArgumentException(
                    "step must be 0..%d, got %d".formatted(STEPS_PER_PATTERN - 1, step));
        }
        if (pitch == null || !PITCH_FORMAT.matcher(pitch).matches()) {
            throw new IllegalArgumentException("pitch must look like C4 or F#2, got: " + pitch);
        }
        if (velocity <= 0.0 || velocity > 1.0) {
            throw new IllegalArgumentException("velocity must be in (0, 1], got " + velocity);
        }
    }
}
