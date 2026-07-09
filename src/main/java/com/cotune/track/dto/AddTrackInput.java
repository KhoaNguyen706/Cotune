package com.cotune.track.dto;

import com.cotune.track.Instrument;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Note what is ABSENT: position. The server assigns it (append at end).
 * Letting clients pick a slot invites duplicate-position races and is a
 * reordering concern — which, in a collaborative editor, is an operation
 * with ordering semantics, not a CRUD field.
 */
public record AddTrackInput(

        @NotNull(message = "songId is required")
        UUID songId,

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
