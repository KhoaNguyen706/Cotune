package com.cotune.history;

import com.cotune.history.dto.SongEventDto;
import com.cotune.track.dto.StepDto;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.UUID;

/**
 * History's read surface — QUERIES, both of them, and that's the design:
 * restore is not a mutation here. trackPatternAt returns a historical
 * grid; the client lands it exactly like AI generation (one undoable
 * local edit) and KEEPING it is an ordinary save through the existing
 * machinery, which broadcasts it live and — of course — records it in
 * history. The past is read-only; changing the present is the job the
 * app already knows how to do.
 *
 * canVIEW on both: looking at history is looking at the song, and a
 * VIEWER may look. Restoring requires edit rights, which the save the
 * client eventually makes enforces where it always did.
 */
@Controller
@RequiredArgsConstructor
@PreAuthorize("isAuthenticated()")
public class SongHistoryGraphqlController {

    private final SongHistoryService songHistoryService;

    @QueryMapping
    @PreAuthorize("isAuthenticated() and @songAccess.canView(#songId, authentication)")
    public List<SongEventDto> songHistory(@Argument UUID songId, @Argument int limit) {
        return songHistoryService.history(songId, limit);
    }

    @QueryMapping
    @PreAuthorize("isAuthenticated() and @trackAccess.canView(#trackId, authentication)")
    public List<StepDto> trackPatternAt(@Argument UUID trackId, @Argument long eventId) {
        return songHistoryService.patternAt(trackId, eventId).stream()
                .map(note -> new StepDto(note.step(), note.pitch(), note.velocity(), note.length()))
                .toList();
    }
}
