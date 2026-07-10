package com.cotune.track.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Body of PATCH /api/tracks/{id} — a rename touches nothing else. */
public record RenameTrackInput(

        @NotBlank(message = "name must not be blank")
        @Size(max = 80, message = "name must be at most 80 characters")
        String name
) {
}
