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

    /** Name-only change — the REST rename endpoint's use case. */
    TrackDto rename(UUID id, String name);

    /**
     * Replace the track's whole step pattern (the beat grid saves as one
     * unit). expectedVersion, when present, must match the row's current
     * @Version or the save is rejected as a conflict — two editors can't
     * silently overwrite each other's grids.
     */
    TrackDto updatePattern(UUID id, List<StepInput> pattern, Long expectedVersion);

    void delete(UUID id);

    /**
     * Batch contract, shaped for the GraphQL @BatchMapping resolver: given
     * N beat ids, return all their lanes grouped by beat — in ONE query.
     * A per-beat variant (getByBeatId) would invite N+1 usage; deliberately
     * not offered until something genuinely needs it.
     */
    Map<UUID, List<TrackDto>> getByBeatIds(List<UUID> beatIds);
}
