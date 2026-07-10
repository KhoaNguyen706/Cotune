package com.cotune.clip.dto;

import com.cotune.clip.Clip;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Geometry only — what a clip POINTS AT never changes after creation
 * (delete and re-place instead; that's also the video-editor convention).
 */
public record UpdateClipInput(

        @Min(0)
        int lane,

        @Min(0)
        @Max(Clip.MAX_TIMELINE_STEPS - 1)
        int startStep,

        @Min(1)
        @Max(Clip.MAX_TIMELINE_STEPS)
        int lengthSteps
) {
}
