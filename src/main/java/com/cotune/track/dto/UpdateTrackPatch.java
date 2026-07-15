package com.cotune.track.dto;

import jakarta.validation.constraints.Size;

/**
 * Body of PATCH /api/tracks/{id}: every field optional, null = leave
 * unchanged (same PATCH semantics as UpdateBeatPatch). Grew from the old
 * rename-only body when the mixer moved server-side (V14) — the range
 * rules live in Track's guarded mutators, as always.
 */
public record UpdateTrackPatch(

        @Size(max = 80, message = "name must be at most 80 characters")
        String name,

        /** Linear gain 0..1 (1 = unity). */
        Double volume,

        /** Stereo position -1..1 (0 = center). */
        Double pan
) {
    public boolean isEmpty() {
        return name == null && volume == null && pan == null;
    }
}
