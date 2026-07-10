package com.cotune.beat;

import com.cotune.beat.dto.AddBeatInput;
import com.cotune.beat.dto.BeatDto;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface BeatService {

    BeatDto add(AddBeatInput input);

    /** Name-only change — the REST rename endpoint's use case. */
    BeatDto rename(UUID id, String name);

    void delete(UUID id);

    /** Batch contract for the Song.beats GraphQL resolver. */
    Map<UUID, List<BeatDto>> getBySongIds(List<UUID> songIds);
}
