package com.cotune.song;

import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

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
                song.getVersion(),
                toUtc(song.getCreatedAt()),
                toUtc(song.getUpdatedAt())
        );
    }

    public Song toEntity(CreateSongInput input) {
        // Goes through the entity's guarded constructor — the mapper does
        // NOT get to bypass domain invariants with field assignment.
        return new Song(input.title(), input.bpm(), input.timeSignature());
    }

    private OffsetDateTime toUtc(Instant instant) {
        // Entities store Instant (an unambiguous point on the timeline);
        // the API speaks OffsetDateTime because the GraphQL DateTime scalar
        // is RFC-3339, which requires an explicit offset. We standardize on
        // UTC at the boundary — clients localize for display.
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
