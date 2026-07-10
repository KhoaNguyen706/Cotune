package com.cotune.song;

import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.dto.SongDto;
import com.cotune.user.UserRepository;
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
class SongServiceImplTest {

    @Mock
    private SongRepository songRepository;

    @Mock
    private UserRepository userRepository;

    private SongServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new SongServiceImpl(songRepository, new SongMapper(), userRepository);
    }

    @Test
    void renameChangesTitleAndNothingElse() {
        UUID songId = UUID.randomUUID();
        Song song = new Song("Old Title", 128, "3/4", UUID.randomUUID());
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));

        SongDto dto = service.rename(songId, "  New Title  ");

        assertThat(dto.title()).isEqualTo("New Title");
        assertThat(dto.bpm()).isEqualTo(128);
        assertThat(dto.timeSignature()).isEqualTo("3/4");
    }

    @Test
    void renameRejectsUnknownSongAndBlankTitle() {
        UUID songId = UUID.randomUUID();
        when(songRepository.findById(songId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.rename(songId, "New Title"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(songId.toString());

        Song song = new Song("Old Title", 128, "4/4", UUID.randomUUID());
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        assertThatThrownBy(() -> service.rename(songId, "   "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
