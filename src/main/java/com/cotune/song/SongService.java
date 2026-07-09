package com.cotune.song;

import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongInput;

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

    SongDto create(CreateSongInput input);

    SongDto getById(UUID id);

    List<SongDto> getAll();

    SongDto update(UUID id, UpdateSongInput input);

    void delete(UUID id);
}
