package com.cotune.beat;

import com.cotune.beat.dto.AddBeatInput;
import com.cotune.beat.dto.BeatDto;
import com.cotune.beat.dto.UpdateBeatPatch;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface BeatService {

    BeatDto add(AddBeatInput input);

    /**
     * Partial update (REST PATCH): only non-null fields change. Shrinking
     * bars is rejected while any lane has notes past the new boundary.
     */
    BeatDto patch(UUID id, UpdateBeatPatch patch);

    void delete(UUID id);

    /** Batch contract for the Song.beats GraphQL resolver. */
    Map<UUID, List<BeatDto>> getBySongIds(List<UUID> songIds);
}
