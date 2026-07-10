package com.cotune.song;

import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.exception.StaleVersionException;
import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongPatch;
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
    void patchChangesOnlyProvidedFields() {
        UUID songId = UUID.randomUUID();
        Song song = new Song("Old Title", 128, "3/4", UUID.randomUUID());
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));

        SongDto dto = service.patch(songId, new UpdateSongPatch("  New Title  ", null, null, null));

        assertThat(dto.title()).isEqualTo("New Title");
        assertThat(dto.bpm()).isEqualTo(128);
        assertThat(dto.timeSignature()).isEqualTo("3/4");

        dto = service.patch(songId, new UpdateSongPatch(null, 90, "4/4", null));

        assertThat(dto.title()).isEqualTo("New Title");
        assertThat(dto.bpm()).isEqualTo(90);
        assertThat(dto.timeSignature()).isEqualTo("4/4");
    }

    @Test
    void patchRejectsUnknownSongEmptyPatchAndInvalidValues() {
        UUID songId = UUID.randomUUID();
        when(songRepository.findById(songId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.patch(songId, new UpdateSongPatch("New Title", null, null, null)))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(songId.toString());

        // Empty patch is caught before any repository access.
        assertThatThrownBy(() -> service.patch(songId, new UpdateSongPatch(null, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at least one field");

        Song song = new Song("Old Title", 128, "4/4", UUID.randomUUID());
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        // Domain guards fire for each present-but-invalid field.
        assertThatThrownBy(() -> service.patch(songId, new UpdateSongPatch("   ", null, null, null)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.patch(songId, new UpdateSongPatch(null, 1000, null, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("BPM");
        assertThatThrownBy(() -> service.patch(songId, new UpdateSongPatch(null, null, "waltz", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Time signature");
    }

    @Test
    void patchHonorsExpectedVersion() {
        UUID songId = UUID.randomUUID();
        Song song = new Song("Title", 120, "4/4", UUID.randomUUID()); // fresh entity: version 0
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));

        // Matching version → applies.
        assertThat(service.patch(songId, new UpdateSongPatch("New", null, null, 0L)).title())
                .isEqualTo("New");

        // Stale version → conflict, and nothing was applied.
        assertThatThrownBy(() -> service.patch(songId, new UpdateSongPatch("Ignored", null, null, 5L)))
                .isInstanceOf(StaleVersionException.class)
                .hasMessageContaining("version");
        assertThat(song.getTitle()).isEqualTo("New");
    }
}
