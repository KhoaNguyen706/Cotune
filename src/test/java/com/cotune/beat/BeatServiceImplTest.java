package com.cotune.beat;

import com.cotune.beat.dto.BeatDto;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * Same isolation recipe as TrackServiceImplTest: mocked repositories,
 * real mapper (pure function).
 */
@ExtendWith(MockitoExtension.class)
class BeatServiceImplTest {

    @Mock
    private BeatRepository beatRepository;

    @Mock
    private SongRepository songRepository;

    private BeatServiceImpl service;

    private final Song song = new Song("Test Song", 120, "4/4", UUID.randomUUID());

    @BeforeEach
    void setUp() {
        service = new BeatServiceImpl(beatRepository, songRepository, new BeatMapper());
    }

    @Test
    void renameStripsWhitespaceAndKeepsPosition() {
        UUID beatId = UUID.randomUUID();
        Beat beat = new Beat(song, "Beat 1", 3);
        when(beatRepository.findById(beatId)).thenReturn(Optional.of(beat));

        BeatDto dto = service.rename(beatId, "  Drop  ");

        assertThat(dto.name()).isEqualTo("Drop");
        assertThat(dto.position()).isEqualTo(3);
    }

    @Test
    void renameRejectsUnknownBeatAndBlankName() {
        UUID beatId = UUID.randomUUID();
        when(beatRepository.findById(beatId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.rename(beatId, "Drop"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(beatId.toString());

        Beat beat = new Beat(song, "Beat 1", 0);
        when(beatRepository.findById(beatId)).thenReturn(Optional.of(beat));
        assertThatThrownBy(() -> service.rename(beatId, "   "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
