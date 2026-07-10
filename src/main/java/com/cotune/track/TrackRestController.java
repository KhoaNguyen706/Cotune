package com.cotune.track;

import com.cotune.track.dto.RenameTrackInput;
import com.cotune.track.dto.TrackDto;
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
public class TrackRestController {

    private final TrackService trackService;

    @PatchMapping("/api/tracks/{id}")
    public TrackDto rename(@PathVariable UUID id, @RequestBody @Valid RenameTrackInput input) {
        return trackService.rename(id, input.name());
    }
}
