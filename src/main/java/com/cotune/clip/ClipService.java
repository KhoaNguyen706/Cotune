package com.cotune.clip;

import com.cotune.clip.dto.AddClipInput;
import com.cotune.clip.dto.ClipDto;
import com.cotune.clip.dto.UpdateClipInput;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface ClipService {

    ClipDto add(AddClipInput input);

    ClipDto update(UUID id, UpdateClipInput input);

    void delete(UUID id);

    /** Batch contract for the Song.clips GraphQL resolver. */
    Map<UUID, List<ClipDto>> getBySongIds(List<UUID> songIds);
}
