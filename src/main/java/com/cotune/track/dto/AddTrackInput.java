package com.cotune.track.dto;

import com.cotune.track.Instrument;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Since V7 a lane is added to a BEAT (the multi-instrument pattern group),
 * not to the song directly. Note what is ABSENT: position. The server
 * assigns it (append at end) — letting clients pick a slot invites
 * duplicate-position races.
 */
public record AddTrackInput(

        @NotNull(message = "beatId is required")
        UUID beatId,

        @NotBlank(message = "name must not be blank")
        @Size(max = 80, message = "name must be at most 80 characters")
        String name,

        // GraphQL already guarantees a valid Instrument constant (the enum
        // is type-checked in the schema); @NotNull only guards direct Java
        // callers, e.g. tests.
        @NotNull(message = "instrument is required")
        Instrument instrument
) {
}
