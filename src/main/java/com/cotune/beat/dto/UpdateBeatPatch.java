package com.cotune.beat.dto;

import jakarta.validation.constraints.Size;

/**
 * Body of PATCH /api/beats/{id}: every field optional, null = leave
 * unchanged (same PATCH semantics as UpdateSongPatch). Range rules live
 * in the Beat entity's guarded mutators; the shrink-safety rule (bars may
 * not cut existing notes) lives in the service, which can see the lanes.
 */
public record UpdateBeatPatch(

        @Size(max = 80, message = "name must be at most 80 characters")
        String name,

        Integer bars,

        /** Optional optimistic-concurrency guard — see UpdateSongPatch. */
        Long expectedVersion
) {
    public boolean isEmpty() {
        return name == null && bars == null;
    }
}
