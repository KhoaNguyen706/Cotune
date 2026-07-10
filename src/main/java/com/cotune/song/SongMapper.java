package com.cotune.song;

import com.cotune.common.mapping.Timestamps;
import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Translates between the persistence model (entity) and the API model (DTO).
 * Hand-written on purpose for now: you can read every line of the
 * translation. In production, teams often generate this with MapStruct
 * (compile-time code generation — same output, less typing); switching
 * later is mechanical because everything already flows through this class.
 *
 * It is a stateless @Component, not static methods, so it can be injected
 * and swapped/mocked in tests like any other collaborator.
 */
@Component
public class SongMapper {

    public SongDto toDto(Song song) {
        return new SongDto(
                song.getId(),
                song.getTitle(),
                song.getBpm(),
                song.getTimeSignature(),
                song.getOwnerId(),
                song.getVersion(),
                Timestamps.utc(song.getCreatedAt()),
                Timestamps.utc(song.getUpdatedAt())
        );
    }

    // ownerId is a separate parameter, not a field on CreateSongInput:
    // the owner comes from the AUTHENTICATED CALLER, never from the request
    // body — a client that could name an arbitrary owner could plant songs
    // on other people's accounts (the same mass-assignment reasoning as
    // Role in RegisterInput).
    public Song toEntity(CreateSongInput input, UUID ownerId) {
        // Goes through the entity's guarded constructor — the mapper does
        // NOT get to bypass domain invariants with field assignment.
        return new Song(input.title(), input.bpm(), input.timeSignature(), ownerId);
    }
}
