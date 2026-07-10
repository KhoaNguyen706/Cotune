package com.cotune.clip.dto;

import com.cotune.clip.Clip;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * No `type` field: it's DERIVED from which reference is present (exactly
 * one of beatId/audioId). Asking clients to send both a type and a
 * matching id is a consistency bug waiting to be sent over the wire.
 */
public record AddClipInput(

        @NotNull(message = "songId is required")
        UUID songId,

        @Min(0)
        int lane,

        @Min(0)
        @Max(Clip.MAX_TIMELINE_STEPS - 1)
        int startStep,

        @Min(1)
        @Max(Clip.MAX_TIMELINE_STEPS)
        int lengthSteps,

        UUID beatId,

        UUID audioId
) {
}
