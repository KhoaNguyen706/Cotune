package com.cotune.song.dto;

import com.cotune.song.Song;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Full-replace semantics (every field required), like HTTP PUT. Partial
 * updates in GraphQL need nullable fields plus "was this field omitted or
 * set to null?" handling — a deliberate later step, because in a
 * collaborative editor per-field patches become operations with ordering
 * concerns, not simple updates.
 *
 * Identical shape to CreateSongInput today, but kept as a separate type:
 * the two WILL diverge (e.g. create may take an initial track list), and
 * sharing a DTO across use cases couples them forever.
 */
public record UpdateSongInput(

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
