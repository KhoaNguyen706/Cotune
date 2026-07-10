package com.cotune.song;

import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongInput;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.util.List;
import java.util.UUID;

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

    // GraphQL ID arrives as a String; Spring's conversion service parses it
    // into UUID for us. A malformed id fails binding before our code runs.
    @QueryMapping
    public SongDto song(@Argument UUID id) {
        return songService.getById(id);
    }

    @QueryMapping
    public List<SongDto> songs() {
        return songService.getAll();
    }

    @MutationMapping
    public SongDto createSong(@Argument @Valid CreateSongInput input, Authentication authentication) {
        // The owner is WHO YOU ARE, taken from the verified token — never
        // an input field a client could set to someone else's id.
        return songService.create(input, UUID.fromString(authentication.getName()));
    }

    @MutationMapping
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
