package com.cotune.track;

import com.cotune.song.dto.SongDto;
import com.cotune.track.dto.AddTrackInput;
import com.cotune.track.dto.StepInput;
import com.cotune.track.dto.TrackDto;
import com.cotune.track.dto.UpdateTrackInput;
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
// Same class-level rule as SongGraphqlController; it also covers the
// @BatchMapping below (Song.tracks is only reachable via queries that are
// themselves authenticated, but defense in depth costs one annotation).
@PreAuthorize("isAuthenticated()")
public class TrackGraphqlController {

    private final TrackService trackService;

    @MutationMapping
    public TrackDto addTrack(@Argument @Valid AddTrackInput input) {
        return trackService.add(input);
    }

    @MutationMapping
    public TrackDto updateTrack(@Argument UUID id, @Argument @Valid UpdateTrackInput input) {
        return trackService.update(id, input);
    }

    @MutationMapping
    public boolean deleteTrack(@Argument UUID id) {
        trackService.delete(id);
        return true;
    }

    // @Valid on a List cascades into the StepInput elements (each is
    // validated against its own annotations). The domain Step re-checks
    // everything anyway — boundary errors are friendlier, domain errors
    // are the guarantee.
    @MutationMapping
    public TrackDto updateTrackPattern(@Argument UUID id, @Argument @Valid List<StepInput> pattern) {
        return trackService.updatePattern(id, pattern);
    }

    /**
     * Resolves Song.tracks — THE most important method of this session.
     *
     * The naive version is @SchemaMapping(typeName = "Song") taking ONE
     * SongDto and querying its tracks: correct results, but GraphQL calls
     * it once PER SONG, so `{ songs { tracks } }` with 50 songs fires
     * 1 + 50 SQL queries. That's the N+1 problem.
     *
     * @BatchMapping changes the execution contract: the engine collects
     * every Song in the current query and calls this method ONCE with all
     * of them; we return a Map telling it which tracks belong to which
     * song. 51 queries become 2. This is Spring's sugar over the
     * DataLoader pattern (batch-and-cache within one request).
     *
     * typeName must be spelled out because the source object is a SongDto —
     * Spring can't guess that "SongDto" plays the schema type "Song".
     */
    @BatchMapping(typeName = "Song", field = "tracks")
    public Map<SongDto, List<TrackDto>> tracks(List<SongDto> songs) {
        Map<UUID, List<TrackDto>> tracksBySongId =
                trackService.getBySongIds(songs.stream().map(SongDto::id).toList());

        // The engine wants the map keyed by the SAME SongDto instances it
        // handed us. getOrDefault matters: a song with zero tracks must map
        // to an empty list — a missing key would resolve the non-nullable
        // field `tracks: [Track!]!` to null and error the whole song.
        return songs.stream().collect(Collectors.toMap(
                Function.identity(),
                song -> tracksBySongId.getOrDefault(song.id(), List.of())));
    }
}
