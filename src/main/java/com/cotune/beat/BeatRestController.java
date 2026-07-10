package com.cotune.beat;

import com.cotune.beat.dto.BeatDto;
import com.cotune.beat.dto.UpdateBeatPatch;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Single-field updates ride on REST — see SongRestController. */
@RestController
@RequiredArgsConstructor
public class BeatRestController {

    private final BeatService beatService;

    @PatchMapping("/api/beats/{id}")
    @PreAuthorize("@beatAccess.canEdit(#id, authentication)")
    public BeatDto patch(@PathVariable UUID id, @RequestBody @Valid UpdateBeatPatch patch) {
        return beatService.patch(id, patch);
    }
}
