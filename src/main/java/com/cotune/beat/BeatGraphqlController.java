package com.cotune.beat;

import com.cotune.beat.dto.AddBeatInput;
import com.cotune.beat.dto.BeatDto;
import com.cotune.song.dto.SongDto;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.BatchMapping;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Controller
@Validated
@RequiredArgsConstructor
@PreAuthorize("isAuthenticated()")
public class BeatGraphqlController {

    private final BeatService beatService;

    @MutationMapping
    public BeatDto addBeat(@Argument @Valid AddBeatInput input) {
        return beatService.add(input);
    }

    @MutationMapping
    public boolean deleteBeat(@Argument UUID id) {
        beatService.delete(id);
        return true;
    }

    // Song.beats — same batch contract as every child resolver here.
    @BatchMapping(typeName = "Song", field = "beats")
    public Map<SongDto, List<BeatDto>> beats(List<SongDto> songs) {
        Map<UUID, List<BeatDto>> beatsBySongId =
                beatService.getBySongIds(songs.stream().map(SongDto::id).toList());

        return songs.stream().collect(Collectors.toMap(
                Function.identity(),
                song -> beatsBySongId.getOrDefault(song.id(), List.of())));
    }
}
