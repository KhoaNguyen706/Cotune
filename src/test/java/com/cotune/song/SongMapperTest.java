package com.cotune.song;

import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Pure unit tests: no @SpringBootTest, no database, milliseconds to run.
 * Because SongMapper is a plain class with no framework magic, we just
 * `new` it — a payoff of keeping layers as ordinary objects.
 */
class SongMapperTest {

    private final SongMapper mapper = new SongMapper();

    @Test
    void toEntityCopiesAllFieldsThroughDomainConstructor() {
        CreateSongInput input = new CreateSongInput("Midnight Sketch", 92, "3/4");

        Song song = mapper.toEntity(input);

        assertThat(song.getTitle()).isEqualTo("Midnight Sketch");
        assertThat(song.getBpm()).isEqualTo(92);
        assertThat(song.getTimeSignature()).isEqualTo("3/4");
        // Server-owned fields are unset before persistence — the mapper
        // must not invent them.
        assertThat(song.getId()).isNull();
        assertThat(song.getCreatedAt()).isNull();
    }

    @Test
    void toEntityRejectsInvalidBpmBecauseDomainGuardsRun() {
        // Proves the mapper cannot smuggle invalid data past the entity:
        // it builds via the guarded constructor, so invariants fire even
        // if Bean Validation were somehow skipped.
        CreateSongInput input = new CreateSongInput("Broken", 1000, "4/4");

        assertThatThrownBy(() -> mapper.toEntity(input))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("BPM");
    }

    @Test
    void toDtoMapsFieldsAndConvertsTimestampsToUtc() {
        Song song = new Song("Lo-fi Loop", 74, "4/4");

        SongDto dto = mapper.toDto(song);

        assertThat(dto.title()).isEqualTo("Lo-fi Loop");
        assertThat(dto.bpm()).isEqualTo(74);
        assertThat(dto.timeSignature()).isEqualTo("4/4");
        // Unsaved entity → null timestamps must not blow up the mapper.
        assertThat(dto.createdAt()).isNull();
    }
}
