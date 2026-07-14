package com.cotune.listen;

import com.cotune.listen.dto.ListenSongDto;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import com.cotune.song.dto.SongDto;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.BatchMapping;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * NO class-level @PreAuthorize — deliberately, and the exception in this
 * codebase: `listen` is the one GraphQL operation that must work for
 * someone with no account, because that's the entire feature. Safety
 * comes from the other direction: the query's AUTHORIZATION is the token
 * (unguessable, revocable) and its SURFACE is the Listen* types, which
 * carry nothing private by construction. The two mutations put their
 * guards back on explicitly.
 */
@Controller
@RequiredArgsConstructor
public class ListenGraphqlController {

    private final ListenService listenService;
    private final SongRepository songRepository;

    /** The public read. Wrong/revoked token → NOT_FOUND, same as a miss. */
    @QueryMapping
    public ListenSongDto listen(@Argument String token) {
        return listenService.byToken(token);
    }

    // canShare, not canEdit: publishing a link decides WHO GETS IN, and
    // that power stays with the owner — the same reasoning that keeps
    // EDITORs out of shareSong (see SongAccess's table).
    @MutationMapping
    @PreAuthorize("isAuthenticated() and @songAccess.canShare(#songId, authentication)")
    public String enableListenLink(@Argument UUID songId) {
        return listenService.enableListenLink(songId);
    }

    @MutationMapping
    @PreAuthorize("isAuthenticated() and @songAccess.canShare(#songId, authentication)")
    public boolean disableListenLink(@Argument UUID songId) {
        listenService.disableListenLink(songId);
        return true;
    }

    /**
     * Song.listenToken — OWNER-ONLY by value, not by annotation: a field
     * resolver that throws FORBIDDEN would nuke the whole songs query for
     * everyone else, so non-owners simply read null (indistinguishable
     * from "no link", which for them is the truth that matters).
     *
     * @BatchMapping for the same N+1 reason as Song.myRole: one query per
     * page of songs, not one per card.
     */
    @BatchMapping(typeName = "Song", field = "listenToken")
    public Map<SongDto, String> listenToken(List<SongDto> songs, Authentication authentication) {
        UUID caller = callerId(authentication);
        Map<UUID, String> tokensByOwnSong = new HashMap<>();
        if (caller != null) {
            for (Song song : songRepository.findAllById(songs.stream().map(SongDto::id).toList())) {
                if (caller.equals(song.getOwnerId()) && song.getListenToken() != null) {
                    tokensByOwnSong.put(song.getId(), song.getListenToken());
                }
            }
        }
        // A null VALUE for absent entries — Map.of/toMap reject nulls, and
        // GraphQL needs an explicit null per key for this nullable field.
        Map<SongDto, String> result = new HashMap<>();
        for (SongDto song : songs) {
            result.put(song, tokensByOwnSong.get(song.id()));
        }
        return result;
    }

    private static UUID callerId(Authentication authentication) {
        if (authentication == null) {
            return null;
        }
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException notAUuid) {
            return null; // anonymous — owns nothing
        }
    }
}
