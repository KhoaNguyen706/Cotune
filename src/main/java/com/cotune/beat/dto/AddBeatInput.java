package com.cotune.beat.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/** No position — server appends at the end, same as lanes. */
public record AddBeatInput(

        @NotNull(message = "songId is required")
        UUID songId,

        @NotBlank(message = "name must not be blank")
        @Size(max = 80, message = "name must be at most 80 characters")
        String name
) {
}
