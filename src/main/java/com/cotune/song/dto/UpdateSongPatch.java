package com.cotune.song.dto;

import jakarta.validation.constraints.Size;

/**
 * Body of PATCH /api/songs/{id}: every field optional, null = leave
 * unchanged — true PATCH semantics, unlike UpdateSongInput (GraphQL's
 * full-replace update). Range/format rules live in the Song entity's
 * guarded mutators; only shape checks belong here.
 */
public record UpdateSongPatch(

        @Size(max = 120, message = "title must be at most 120 characters")
        String title,

        Integer bpm,

        String timeSignature,

        /** Optional optimistic-concurrency guard: reject with 409 when the
         *  song's version has moved past this. Null = blind write. */
        Long expectedVersion
) {
    public boolean isEmpty() {
        // expectedVersion alone changes nothing — it's a guard, not a field.
        return title == null && bpm == null && timeSignature == null;
    }
}
