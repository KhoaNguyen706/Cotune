package com.cotune.audio;

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
    private final AudioMapper audioMapper;

    @Override
    public AudioFileDto upload(UUID songId, String filename, String contentType,
                               double durationSeconds, byte[] data) {
        // Same idiom as TrackServiceImpl.add: existence check for a clean
        // NOT_FOUND, then a lazy reference to fill the FK without a SELECT.
        if (!songRepository.existsById(songId)) {
            throw ResourceNotFoundException.song(songId);
        }
        Song songRef = songRepository.getReferenceById(songId);

        // saveAndFlush, not save: @CreationTimestamp is populated at INSERT
        // time, and with in-memory UUID generation nothing forces that
        // insert before the mapper reads createdAt — plain save() would
        // return createdAt: null to the uploader.
        AudioFile saved = audioFileRepository.saveAndFlush(
                new AudioFile(songRef, filename, contentType, durationSeconds, data));
        return audioMapper.toDto(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public AudioFile download(UUID id) {
        return audioFileRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.audioFile(id));
    }

    @Override
    public void delete(UUID id) {
        if (!audioFileRepository.existsById(id)) {
            throw ResourceNotFoundException.audioFile(id);
        }
        // Clips referencing this file disappear with it (ON DELETE CASCADE,
        // V6) — the timeline never points at missing media.
        audioFileRepository.deleteById(id);
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
