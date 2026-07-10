package com.cotune.song;

import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongPatch;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Simple single-field mutations ride on REST, not GraphQL — a rename has no
 * field-selection story (the caller wants the one updated object back), so
 * the graph buys nothing here. PATCH because the body carries only the
 * fields being changed, not a full replacement (that would be PUT).
 *
 * Under /api/** SecurityConfig already requires an authenticated caller —
 * URL-identified operations get their auth rule at the HTTP layer, no
 * @PreAuthorize needed (same note as AudioRestController).
 */
@RestController
@RequiredArgsConstructor
public class SongRestController {

    private final SongService songService;

    // URL rules cover "must be logged in"; the OWNER rule is object-level
    // and needs method security (same split as the GraphQL mutations).
    @PatchMapping("/api/songs/{id}")
    @PreAuthorize("@songAccess.canEdit(#id, authentication)")
    public SongDto patch(@PathVariable UUID id, @RequestBody @Valid UpdateSongPatch patch) {
        return songService.patch(id, patch);
    }
}
