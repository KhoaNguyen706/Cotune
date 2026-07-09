package com.cotune.track;

import com.cotune.song.Song;
import com.cotune.track.dto.TrackDto;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TrackMapperTest {

    private final TrackMapper mapper = new TrackMapper();

    @Test
    void toDtoCopiesAllFields() {
        Song song = new Song("Host Song", 100, "4/4");
        Track track = new Track(song, "Warm Pad", Instrument.STRINGS, 1);

        TrackDto dto = mapper.toDto(track);

        assertThat(dto.name()).isEqualTo("Warm Pad");
        assertThat(dto.instrument()).isEqualTo(Instrument.STRINGS);
        assertThat(dto.position()).isEqualTo(1);
        // Unsaved song → null id flows through; the mapper doesn't invent one.
        assertThat(dto.songId()).isNull();
    }

    @Test
    void trackConstructionEnforcesInvariants() {
        Song song = new Song("Host Song", 100, "4/4");

        assertThatThrownBy(() -> new Track(null, "Pad", Instrument.SYNTH, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Track(song, "  ", Instrument.SYNTH, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Track(song, "Pad", null, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Track(song, "Pad", Instrument.SYNTH, -1))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
