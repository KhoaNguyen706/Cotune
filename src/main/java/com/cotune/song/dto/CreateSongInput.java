package com.cotune.song.dto;

import com.cotune.song.Song;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Validation lives at the API boundary so garbage is rejected before it
 * reaches the domain. The entity re-checks the same invariants — boundary
 * validation produces friendly errors, entity validation is the last line
 * of defense. Belt and suspenders, on purpose.
 */
public record CreateSongInput(

        @NotBlank(message = "title must not be blank")
        @Size(max = 120, message = "title must be at most 120 characters")
        String title,

        @Min(value = Song.MIN_BPM, message = "bpm must be at least " + Song.MIN_BPM)
        @Max(value = Song.MAX_BPM, message = "bpm must be at most " + Song.MAX_BPM)
        int bpm,

        @NotBlank
        @Pattern(regexp = "\\d{1,2}/\\d{1,2}", message = "timeSignature must look like 4/4")
        String timeSignature
) {
}
