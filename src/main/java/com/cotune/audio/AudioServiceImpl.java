package com.cotune.audio;

import com.cotune.audio.dto.AudioContent;
import com.cotune.audio.dto.AudioFileDto;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional
@RequiredArgsConstructor
public class AudioServiceImpl implements AudioService {

    private final AudioFileRepository audioFileRepository;
    private final SongRepository songRepository;
    private final AudioStorage audioStorage;
    private final AudioMapper audioMapper;

    @Override
    public AudioFileDto upload(UUID songId, String filename, String contentType,
                               double durationSeconds, byte[] data) {
        // Same idiom as TrackServiceImpl.add: existence check for a clean
        // NOT_FOUND, then a lazy reference to fill the FK without a SELECT.
        if (!songRepository.existsById(songId)) {
            throw ResourceNotFoundException.song(songId);
        }
        if (data == null || data.length == 0) {
            throw new IllegalArgumentException("Audio upload is empty");
        }
        Song songRef = songRepository.getReferenceById(songId);

        // Bytes go to DISK; only the path goes in the row (V9). File first,
        // row second: if the INSERT fails we clean the file up below — the
        // bad crash outcome is an orphan file (sweepable), never a row
        // pointing at bytes that don't exist.
        String storagePath = audioStorage.store(data);
        try {
            // saveAndFlush, not save: @CreationTimestamp is populated at
            // INSERT time, and with in-memory UUID generation nothing forces
            // that insert before the mapper reads createdAt — plain save()
            // would return createdAt: null to the uploader.
            AudioFile saved = audioFileRepository.saveAndFlush(new AudioFile(
                    songRef, filename, contentType, durationSeconds, data.length, storagePath));
            return audioMapper.toDto(saved);
        } catch (RuntimeException e) {
            audioStorage.delete(storagePath);
            throw e;
        }
    }

    @Override
    @Transactional(readOnly = true)
    public AudioContent download(UUID id) {
        AudioFile file = audioFileRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.audioFile(id));
        // Disk for V9+ rows; the bytea column is the legacy fallback.
        byte[] bytes = file.getStoragePath() != null
                ? audioStorage.load(file.getStoragePath())
                : file.getData();
        return new AudioContent(file.getFilename(), file.getContentType(), bytes);
    }

    @Override
    public void delete(UUID id) {
        AudioFile file = audioFileRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.audioFile(id));
        String storagePath = file.getStoragePath();
        // Clips referencing this file disappear with it (ON DELETE CASCADE,
        // V6) — the timeline never points at missing media. Row first, file
        // second (same orphan-file-over-dangling-row reasoning as upload).
        audioFileRepository.delete(file);
        audioFileRepository.flush();
        if (storagePath != null) {
            audioStorage.delete(storagePath);
        }
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, List<AudioFileDto>> getBySongIds(List<UUID> songIds) {
        return audioFileRepository.findSummariesBySongIds(songIds).stream()
                .collect(Collectors.groupingBy(
                        AudioFileSummary::songId,
                        LinkedHashMap::new,
                        Collectors.mapping(audioMapper::toDto, Collectors.toList())));
    }
}
