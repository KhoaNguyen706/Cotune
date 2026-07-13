package com.cotune.audio;

import com.cotune.audio.dto.AudioContent;
import com.cotune.audio.dto.AudioFileDto;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Mocked repositories, REAL AudioStorage on a JUnit temp dir — the disk
 * behavior (store/cleanup/fallback) is exactly what this feature is, so
 * mocking the storage would test nothing.
 */
@ExtendWith(MockitoExtension.class)
class AudioServiceImplTest {

    @Mock
    private AudioFileRepository audioFileRepository;

    @Mock
    private SongRepository songRepository;

    @TempDir
    Path tempDir;

    private AudioStorage storage;
    private AudioServiceImpl service;

    private final UUID songId = UUID.randomUUID();
    private final Song song = new Song("Test Song", 120, "4/4", UUID.randomUUID());

    @BeforeEach
    void setUp() {
        storage = new LocalAudioStorage(tempDir.toString());
        service = new AudioServiceImpl(audioFileRepository, songRepository, storage, new AudioMapper());
    }

    private long filesOnDisk() throws IOException {
        try (var files = Files.list(tempDir)) {
            return files.count();
        }
    }

    @Test
    void uploadWritesBytesToDiskNotTheRow() throws IOException {
        when(songRepository.existsById(songId)).thenReturn(true);
        when(songRepository.getReferenceById(songId)).thenReturn(song);
        when(audioFileRepository.saveAndFlush(any(AudioFile.class))).thenAnswer(inv -> inv.getArgument(0));

        byte[] bytes = {1, 2, 3, 4};
        AudioFileDto dto = service.upload(songId, "kick.wav", "audio/wav", 0.5, bytes);

        assertThat(dto.sizeBytes()).isEqualTo(4);
        assertThat(filesOnDisk()).isEqualTo(1);
        try (var files = Files.list(tempDir)) {
            assertThat(Files.readAllBytes(files.findFirst().orElseThrow())).isEqualTo(bytes);
        }
    }

    @Test
    void uploadCleansUpTheFileWhenTheInsertFails() throws IOException {
        when(songRepository.existsById(songId)).thenReturn(true);
        when(songRepository.getReferenceById(songId)).thenReturn(song);
        when(audioFileRepository.saveAndFlush(any(AudioFile.class)))
                .thenThrow(new RuntimeException("constraint violation"));

        assertThatThrownBy(() -> service.upload(songId, "kick.wav", "audio/wav", 0.5, new byte[]{1}))
                .isInstanceOf(RuntimeException.class);

        // No orphan: the stored file was removed when the row failed.
        assertThat(filesOnDisk()).isZero();
    }

    @Test
    void downloadReadsDiskForNewRowsAndByteaForLegacyRows() {
        byte[] bytes = {9, 8, 7};
        String path = storage.store(bytes);
        AudioFile diskRow = new AudioFile(song, "a.wav", "audio/wav", 1.0, bytes.length, path);
        UUID diskId = UUID.randomUUID();
        when(audioFileRepository.findById(diskId)).thenReturn(Optional.of(diskRow));

        AudioContent fromDisk = service.download(diskId);
        assertThat(fromDisk.bytes()).isEqualTo(bytes);
        assertThat(fromDisk.contentType()).isEqualTo("audio/wav");

        // Legacy pre-V9 row: bytea set, no storage path. The constructor
        // can no longer build one (new code never should), so simulate the
        // old row shape directly.
        AudioFile legacy = new AudioFile(song, "b.wav", "audio/wav", 1.0, 2, "unused");
        ReflectionTestUtils.setField(legacy, "storagePath", null);
        ReflectionTestUtils.setField(legacy, "data", new byte[]{5, 5});
        UUID legacyId = UUID.randomUUID();
        when(audioFileRepository.findById(legacyId)).thenReturn(Optional.of(legacy));

        assertThat(service.download(legacyId).bytes()).isEqualTo(new byte[]{5, 5});
    }

    @Test
    void deleteRemovesTheRowThenTheFile() throws IOException {
        byte[] bytes = {1};
        String path = storage.store(bytes);
        AudioFile row = new AudioFile(song, "a.wav", "audio/wav", 1.0, 1, path);
        UUID id = UUID.randomUUID();
        when(audioFileRepository.findById(id)).thenReturn(Optional.of(row));

        assertThat(filesOnDisk()).isEqualTo(1);
        service.delete(id);
        assertThat(filesOnDisk()).isZero();
    }
}
