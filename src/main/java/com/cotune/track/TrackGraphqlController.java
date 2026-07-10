package com.cotune.track;

import com.cotune.beat.dto.BeatDto;
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

    // Owner-only mutations — see BeatGraphqlController.addBeat for why the
    // expression restates isAuthenticated().
    @MutationMapping
    @PreAuthorize("isAuthenticated() and @beatAccess.canEdit(#input.beatId(), authentication)")
    public TrackDto addTrack(@Argument @Valid AddTrackInput input) {
        return trackService.add(input);
    }

    @MutationMapping
    @PreAuthorize("isAuthenticated() and @trackAccess.canEdit(#id, authentication)")
    public TrackDto updateTrack(@Argument UUID id, @Argument @Valid UpdateTrackInput input) {
        return trackService.update(id, input);
    }

    @MutationMapping
    @PreAuthorize("isAuthenticated() and @trackAccess.canEdit(#id, authentication)")
    public boolean deleteTrack(@Argument UUID id) {
        trackService.delete(id);
        return true;
    }

    // @Valid on a List cascades into the StepInput elements (each is
    // validated against its own annotations). The domain Step re-checks
    // everything anyway — boundary errors are friendlier, domain errors
    // are the guarantee.
    @MutationMapping
    @PreAuthorize("isAuthenticated() and @trackAccess.canEdit(#id, authentication)")
    public TrackDto updateTrackPattern(@Argument UUID id,
                                       @Argument @Valid List<StepInput> pattern,
                                       @Argument Long expectedVersion) {
        return trackService.updatePattern(id, pattern, expectedVersion);
    }

    /**
     * Resolves Beat.tracks — the N+1 fix explained at length in earlier
     * sessions, retargeted after V7: lanes now hang off beats. The engine
     * collects every Beat in the current query and calls this ONCE; we
     * return a Map keyed by the SAME BeatDto instances it handed us.
     * getOrDefault matters: a beat with zero lanes must map to an empty
     * list — a missing key would resolve the non-nullable `tracks:
     * [Track!]!` to null and error the whole beat.
     */
    @BatchMapping(typeName = "Beat", field = "tracks")
    public Map<BeatDto, List<TrackDto>> tracks(List<BeatDto> beats) {
        Map<UUID, List<TrackDto>> tracksByBeatId =
                trackService.getByBeatIds(beats.stream().map(BeatDto::id).toList());

        return beats.stream().collect(Collectors.toMap(
                Function.identity(),
                beat -> tracksByBeatId.getOrDefault(beat.id(), List.of())));
    }
}
