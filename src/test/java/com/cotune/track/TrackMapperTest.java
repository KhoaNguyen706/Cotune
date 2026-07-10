package com.cotune.track;

import com.cotune.beat.Beat;
import com.cotune.song.Song;
import com.cotune.track.dto.TrackDto;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TrackMapperTest {

    private final TrackMapper mapper = new TrackMapper();

    private Beat newBeat() {
        Song song = new Song("Host Song", 100, "4/4", UUID.randomUUID());
        return new Beat(song, "Beat 1", 0);
    }

    @Test
    void toDtoCopiesAllFields() {
        Track track = new Track(newBeat(), "Warm Pad", Instrument.STRINGS, 1);

        TrackDto dto = mapper.toDto(track);

        assertThat(dto.name()).isEqualTo("Warm Pad");
        assertThat(dto.instrument()).isEqualTo(Instrument.STRINGS);
        assertThat(dto.position()).isEqualTo(1);
        // Unsaved beat → null id flows through; the mapper doesn't invent one.
        assertThat(dto.beatId()).isNull();
    }

    @Test
    void trackConstructionEnforcesInvariants() {
        Beat beat = newBeat();

        assertThatThrownBy(() -> new Track(null, "Pad", Instrument.SYNTH, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Track(beat, "  ", Instrument.SYNTH, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Track(beat, "Pad", null, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Track(beat, "Pad", Instrument.SYNTH, -1))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
