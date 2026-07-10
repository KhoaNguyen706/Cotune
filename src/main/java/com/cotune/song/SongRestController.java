package com.cotune.song;

import com.cotune.song.dto.RenameSongInput;
import com.cotune.song.dto.SongDto;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
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

    @PatchMapping("/api/songs/{id}")
    public SongDto rename(@PathVariable UUID id, @RequestBody @Valid RenameSongInput input) {
        return songService.rename(id, input.title());
    }
}
