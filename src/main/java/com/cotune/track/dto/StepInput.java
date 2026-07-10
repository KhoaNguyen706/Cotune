package com.cotune.track.dto;

import com.cotune.track.Step;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Same belt-and-suspenders as CreateSongInput: these annotations produce
 * friendly errors at the boundary, while the Step record's compact
 * constructor enforces the identical rules as the last line of defense.
 */
public record StepInput(

        // Bounded by the absolute maximum (8 bars); whether the note fits
        // the TARGET beat's bar count is checked in the domain, which can
        // see the beat.
        @Min(0)
        @Max(Step.MAX_STEPS - 1)
        int step,

        @NotBlank
        @Pattern(regexp = "^[A-G]#?[0-8]$", message = "pitch must look like C4 or F#2")
        String pitch,

        @DecimalMin(value = "0.0", inclusive = false)
        @DecimalMax("1.0")
        double velocity,

        // Duration in steps. The schema declares `length: Int! = 1`, so
        // clients that never heard of note lengths (or old saved requests)
        // keep working — additive, defaulted fields are THE way to evolve
        // an API without breaking existing callers.
        @Min(1)
        @Max(Step.MAX_STEPS)
        int length
) {
}
