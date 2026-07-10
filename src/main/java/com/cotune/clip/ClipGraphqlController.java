package com.cotune.clip;

import com.cotune.clip.dto.AddClipInput;
import com.cotune.clip.dto.ClipDto;
import com.cotune.clip.dto.UpdateClipInput;
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
public class ClipGraphqlController {

    private final ClipService clipService;

    @MutationMapping
    public ClipDto addClip(@Argument @Valid AddClipInput input) {
        return clipService.add(input);
    }

    @MutationMapping
    public ClipDto updateClip(@Argument UUID id, @Argument @Valid UpdateClipInput input) {
        return clipService.update(id, input);
    }

    @MutationMapping
    public boolean deleteClip(@Argument UUID id) {
        clipService.delete(id);
        return true;
    }

    // Same batch contract as TrackGraphqlController.tracks — one query for
    // all songs in the request, empty list (not null) for songs with no
    // clips.
    @BatchMapping(typeName = "Song", field = "clips")
    public Map<SongDto, List<ClipDto>> clips(List<SongDto> songs) {
        Map<UUID, List<ClipDto>> clipsBySongId =
                clipService.getBySongIds(songs.stream().map(SongDto::id).toList());

        return songs.stream().collect(Collectors.toMap(
                Function.identity(),
                song -> clipsBySongId.getOrDefault(song.id(), List.of())));
    }
}
