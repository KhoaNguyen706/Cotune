package com.cotune.collab;

import com.cotune.collab.dto.CollaboratorDto;
import com.cotune.collab.dto.ShareSongInput;
import com.cotune.song.dto.SongDto;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.BatchMapping;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The sharing surface. Thin, like every other controller here: bind, check,
 * delegate, return DTOs.
 *
 * Both mutations are gated on canSHARE, not canEdit — and that one word is
 * the whole security design. An EDITOR passes canEdit, so guarding these
 * with canEdit would let any invited editor invite further editors, and
 * evict people, on a song they do not own. Rights that change WHO CAN GET IN
 * stay with the owner; rights that change THE MUSIC are what get delegated.
 */
@Controller
@Validated
@RequiredArgsConstructor
@PreAuthorize("isAuthenticated()")
public class CollaboratorGraphqlController {

    private final CollaboratorService collaboratorService;

    // #input.songId — SpEL reaches into the argument object, so the rule can
    // still be object-level even though the id arrives nested in an input type.
    @MutationMapping
    @PreAuthorize("@songAccess.canShare(#input.songId, authentication)")
    public CollaboratorDto shareSong(@Argument @Valid ShareSongInput input,
                                     Authentication authentication) {
        // The inviter is WHO YOU ARE (from the verified token), never a field
        // the client sends — same mass-assignment rule as ownerId on createSong.
        return collaboratorService.share(input, UUID.fromString(authentication.getName()));
    }

    @MutationMapping
    @PreAuthorize("@songAccess.canShare(#songId, authentication)")
    public boolean unshareSong(@Argument UUID songId, @Argument UUID userId) {
        collaboratorService.unshare(songId, userId);
        return true;
    }

    /**
     * Song.collaborators — batch-resolved, exactly like Song.beats and
     * Song.clips. One query for the whole page of songs; resolving per-song
     * would put an N+1 behind the home screen's share sheets.
     *
     * No @PreAuthorize here: this field can only be reached THROUGH a Song,
     * and every path to a Song (the `song` query, the `songs` query) is
     * already gated by canView. Re-checking would be a second copy of a rule
     * that is enforced at the entrance.
     */
    @BatchMapping(typeName = "Song", field = "collaborators")
    public Map<SongDto, List<CollaboratorDto>> collaborators(List<SongDto> songs) {
        Map<UUID, List<CollaboratorDto>> bySong =
                collaboratorService.listForSongs(songs.stream().map(SongDto::id).toList());

        // Every key MUST get a value: a DataLoader that returns fewer results
        // than it was given keys leaves those fields null, and `[Collaborator!]!`
        // is non-null — the whole Song would be nulled out of the response. A
        // song with nobody on it maps to an empty list, not to "absent".
        return songs.stream().collect(Collectors.toMap(
                Function.identity(),
                song -> bySong.getOrDefault(song.id(), List.of())));
    }
}
