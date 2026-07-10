package com.cotune.beat;

import com.cotune.beat.dto.BeatDto;
import com.cotune.beat.dto.RenameBeatInput;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Rename rides on REST — see SongRestController for the reasoning. */
@RestController
@RequiredArgsConstructor
public class BeatRestController {

    private final BeatService beatService;

    @PatchMapping("/api/beats/{id}")
    public BeatDto rename(@PathVariable UUID id, @RequestBody @Valid RenameBeatInput input) {
        return beatService.rename(id, input.name());
    }
}
