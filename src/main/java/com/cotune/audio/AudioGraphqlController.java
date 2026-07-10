package com.cotune.audio;

import com.cotune.audio.dto.AudioFileDto;
import com.cotune.song.dto.SongDto;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.BatchMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Read side only: audio METADATA lives in the graph (the editor asks for
 * it alongside tracks and clips in one query); the BYTES live on REST —
 * see AudioRestController for the split's reasoning.
 */
@Controller
@RequiredArgsConstructor
@PreAuthorize("isAuthenticated()")
public class AudioGraphqlController {

    private final AudioService audioService;

    @BatchMapping(typeName = "Song", field = "audioFiles")
    public Map<SongDto, List<AudioFileDto>> audioFiles(List<SongDto> songs) {
        Map<UUID, List<AudioFileDto>> filesBySongId =
                audioService.getBySongIds(songs.stream().map(SongDto::id).toList());

        return songs.stream().collect(Collectors.toMap(
                Function.identity(),
                song -> filesBySongId.getOrDefault(song.id(), List.of())));
    }
}
