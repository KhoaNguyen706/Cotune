package com.cotune.song;

import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongInput;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.BatchMapping;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
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
 * The GraphQL adapter. Method names must match the field names declared in
 * schema.graphqls (schema-first): `song`, `songs`, `createSong`, ... —
 * Spring wires each @QueryMapping/@MutationMapping to its schema field by
 * name at startup and FAILS FAST if a schema field has no resolver.
 *
 * Note how thin this class is: translate arguments, delegate, return DTOs.
 * All decisions live in the service — the controller could be replaced by
 * a REST controller tomorrow without touching business logic.
 */
@Controller
@Validated // enables @Valid on method arguments below
@RequiredArgsConstructor
// Class-level default: every operation in here requires a logged-in user.
// HTTP-level rules can't do this (all of GraphQL is one POST /graphql), so
// authorization is enforced at the method layer — see SecurityConfig.
@PreAuthorize("isAuthenticated()")
public class SongGraphqlController {

    private final SongService songService;
    private final SongAccess songAccess;

    // GraphQL ID arrives as a String; Spring's conversion service parses it
    // into UUID for us. A malformed id fails binding before our code runs.
    //
    // canView, not just isAuthenticated(): before V10 any logged-in user could
    // fetch any song by id. Reads need an object-level rule exactly like writes
    // do — "you must be logged in" is not an authorization decision, it is the
    // absence of one.
    @QueryMapping
    @PreAuthorize("isAuthenticated() and @songAccess.canView(#id, authentication)")
    public SongDto song(@Argument UUID id) {
        return songService.getById(id);
    }

    /** The caller's library: songs they own + songs shared with them. */
    @QueryMapping
    public List<SongDto> songs(Authentication authentication) {
        return songService.getVisibleTo(UUID.fromString(authentication.getName()));
    }

    /**
     * Song.myRole — what the CALLER may do with this song, decided server-side.
     *
     * @BatchMapping, not @SchemaMapping: the resolver runs once per PAGE of
     * songs (Spring collects them into a DataLoader and calls this with the
     * whole list), not once per song. @SchemaMapping here would issue two
     * queries per card on the home screen — the N+1 problem, arriving through
     * the authorization layer instead of the data layer, where nobody looks
     * for it.
     *
     * The map may legitimately lack an entry for a song (the caller has no
     * relationship to it), but a GraphQL non-null field must produce a value,
     * so those fall back to VIEWER — the least privilege we can name. In
     * practice that path is only reachable for legacy ownerless songs, since
     * every other query is already gated by canView.
     */
    @BatchMapping(typeName = "Song", field = "myRole")
    public Map<SongDto, SongRole> myRole(List<SongDto> songs, Authentication authentication) {
        UUID caller = UUID.fromString(authentication.getName());
        Map<UUID, SongRole> roles =
                songAccess.rolesFor(caller, songs.stream().map(SongDto::id).toList());

        // Keyed by the DTO itself — records have value equality, which is
        // exactly what a DataLoader's result map needs.
        return songs.stream().collect(Collectors.toMap(
                Function.identity(),
                song -> roles.getOrDefault(song.id(), SongRole.VIEWER)));
    }

    @MutationMapping
    public SongDto createSong(@Argument @Valid CreateSongInput input, Authentication authentication) {
        // The owner is WHO YOU ARE, taken from the verified token — never
        // an input field a client could set to someone else's id.
        return songService.create(input, UUID.fromString(authentication.getName()));
    }

    // Object-level like deleteSong below: only the owner may edit.
    @MutationMapping
    @PreAuthorize("isAuthenticated() and @songAccess.canEdit(#id, authentication)")
    public SongDto updateSong(@Argument UUID id, @Argument @Valid UpdateSongInput input) {
        return songService.update(id, input);
    }

    // Returning the deleted object is impossible (it's gone) and returning
    // void is not a GraphQL type, so Boolean is the conventional ack.
    //
    // Method-level @PreAuthorize OVERRIDES the class-level one (it does not
    // stack). This was hasRole('ADMIN') — a ROLE check — until ownership
    // arrived; now the rule is object-level: only the song's creator may
    // delete it. #id is the method argument, @songAccess is the SongAccess
    // bean, and Spring hands the current Authentication in.
    @MutationMapping
    @PreAuthorize("@songAccess.canDelete(#id, authentication)")
    public boolean deleteSong(@Argument UUID id) {
        songService.delete(id);
        return true;
    }
}
