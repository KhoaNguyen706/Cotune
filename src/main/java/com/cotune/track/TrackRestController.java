package com.cotune.track;

import com.cotune.track.dto.TrackDto;
import com.cotune.track.dto.UpdateTrackPatch;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Single-field updates ride on REST — see SongRestController. Started as
 *  rename-only; V14 added the lane's mixer state (volume/pan), which is the
 *  same shape of update: one field, no graph, high frequency. */
@RestController
@RequiredArgsConstructor
public class TrackRestController {

    private final TrackService trackService;

    @PatchMapping("/api/tracks/{id}")
    @PreAuthorize("@trackAccess.canEdit(#id, authentication)")
    public TrackDto patch(@PathVariable UUID id, @RequestBody @Valid UpdateTrackPatch patch) {
        return trackService.patch(id, patch);
    }
}
