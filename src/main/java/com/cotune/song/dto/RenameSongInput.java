package com.cotune.song.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Body of PATCH /api/songs/{id} — a rename touches nothing else. */
public record RenameSongInput(

        @NotBlank(message = "title must not be blank")
        @Size(max = 120, message = "title must be at most 120 characters")
        String title
) {
}
