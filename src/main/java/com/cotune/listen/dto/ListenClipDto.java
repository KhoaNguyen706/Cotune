package com.cotune.listen.dto;

import com.cotune.clip.ClipType;

import java.util.UUID;

/** One timeline placement, geometry + reference only — enough to schedule. */
public record ListenClipDto(
        UUID id,
        int lane,
        int startStep,
        int lengthSteps,
        ClipType type,
        UUID beatId,
        UUID audioId
) {
}
