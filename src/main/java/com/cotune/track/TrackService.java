package com.cotune.track;

import com.cotune.track.dto.AddTrackInput;
import com.cotune.track.dto.NoteApplied;
import com.cotune.track.dto.NoteOp;
import com.cotune.track.dto.StepInput;
import com.cotune.track.dto.TrackDto;
import com.cotune.track.dto.UpdateTrackInput;
import com.cotune.track.dto.UpdateTrackPatch;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface TrackService {

    TrackDto add(AddTrackInput input);

    TrackDto update(UUID id, UpdateTrackInput input);

    /** Single-field updates from the REST PATCH: name (rename-in-place)
     *  and, since V14, the lane's mixer state (volume/pan). */
    TrackDto patch(UUID id, UpdateTrackPatch patch);

    /**
     * Replace the track's whole step pattern (the beat grid saves as one
     * unit). expectedVersion, when present, must match the row's current
     * @Version or the save is rejected as a conflict — two editors can't
     * silently overwrite each other's grids.
     */
    TrackDto updatePattern(UUID id, List<StepInput> pattern, Long expectedVersion);

    /**
     * Apply ONE note delta to a lane and report the lane's new version — the
     * real-time editing path (session 16).
     *
     * Contrast with updatePattern above, and notice they are opposites:
     * updatePattern REPLACES the lane with the caller's array and refuses if
     * the row moved (expectedVersion), so a concurrent editor gets a CONFLICT.
     * applyNote MERGES the caller's single change into whatever the lane holds
     * right now, so a concurrent editor gets... their note, and yours. The
     * first is right for "I pressed save"; the second is right for "we are both
     * typing".
     *
     * songId is not decoration: it is the id the caller was AUTHORIZED against
     * (canEdit on that song), so the implementation must verify the track
     * actually lives in it. Skip that and anyone who can edit any one song can
     * edit every lane in the database by naming a foreign trackId.
     */
    NoteApplied applyNote(UUID songId, UUID trackId, NoteOp op);

    void delete(UUID id);

    /**
     * Batch contract, shaped for the GraphQL @BatchMapping resolver: given
     * N beat ids, return all their lanes grouped by beat — in ONE query.
     * A per-beat variant (getByBeatId) would invite N+1 usage; deliberately
     * not offered until something genuinely needs it.
     */
    Map<UUID, List<TrackDto>> getByBeatIds(List<UUID> beatIds);
}
