package com.cotune.song;

import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongInput;
import com.cotune.song.dto.UpdateSongPatch;

import java.util.List;
import java.util.UUID;

/**
 * The application's use cases for songs, expressed in DTOs — callers
 * (GraphQL today, maybe a WebSocket handler tomorrow) never see entities.
 *
 * Honest note: many teams skip the interface when there is exactly one
 * implementation ("interface for the sake of it"). We keep it because
 * (a) it documents the contract in one screen, and (b) session goals here
 * include practicing program-to-an-interface. Know that the single-impl
 * interface is a debated style, and be able to argue both sides.
 */
public interface SongService {

    /** ownerId = the authenticated caller; the transport layer supplies it. */
    SongDto create(CreateSongInput input, UUID ownerId);

    SongDto getById(UUID id);

    /**
     * The caller's library: songs they own plus songs shared with them.
     *
     * The viewer is a REQUIRED parameter, not an optional filter, and that is
     * the whole design. This method used to be getAll() — a name that made
     * "return everyone's songs" the natural implementation, and that is
     * exactly what it did. Making the audience part of the signature means a
     * caller cannot forget to scope the query; there is no longer an
     * unscoped version to reach for.
     */
    List<SongDto> getVisibleTo(UUID userId);

    SongDto update(UUID id, UpdateSongInput input);

    /** Partial update (REST PATCH): only non-null fields change. */
    SongDto patch(UUID id, UpdateSongPatch patch);

    void delete(UUID id);
}
