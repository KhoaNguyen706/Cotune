package com.cotune.track.dto;

import com.cotune.track.Instrument;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Full-replace, same convention as UpdateSongInput. No songId — a track
 * never moves between songs (the FK column is updatable = false); modeling
 * "move" as an update would be a delete+create pretending to be an edit.
 */
public record UpdateTrackInput(

        @NotBlank(message = "name must not be blank")
        @Size(max = 80, message = "name must be at most 80 characters")
        String name,

        @NotNull(message = "instrument is required")
        Instrument instrument
) {
}
