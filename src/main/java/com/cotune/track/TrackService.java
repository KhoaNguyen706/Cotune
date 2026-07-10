package com.cotune.track;

import com.cotune.track.dto.AddTrackInput;
import com.cotune.track.dto.StepInput;
import com.cotune.track.dto.TrackDto;
import com.cotune.track.dto.UpdateTrackInput;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface TrackService {

    TrackDto add(AddTrackInput input);

    TrackDto update(UUID id, UpdateTrackInput input);

    /** Replace the track's whole step pattern (the beat grid saves as one unit). */
    TrackDto updatePattern(UUID id, List<StepInput> pattern);

    void delete(UUID id);

    /**
     * Batch contract, shaped for the GraphQL @BatchMapping resolver: given
     * N song ids, return all their tracks grouped by song — in ONE query.
     * A per-song variant (getBySongId) would invite N+1 usage; deliberately
     * not offered until something genuinely needs it.
     */
    Map<UUID, List<TrackDto>> getBySongIds(List<UUID> songIds);
}
