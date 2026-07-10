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

        @Min(0)
        @Max(Step.STEPS_PER_PATTERN - 1)
        int step,

        @NotBlank
        @Pattern(regexp = "^[A-G]#?[0-8]$", message = "pitch must look like C4 or F#2")
        String pitch,

        @DecimalMin(value = "0.0", inclusive = false)
        @DecimalMax("1.0")
        double velocity
) {
}
