package com.cotune.clip;

import com.cotune.audio.AudioFileRepository;
import com.cotune.beat.BeatRepository;
import com.cotune.clip.dto.AddClipInput;
import com.cotune.clip.dto.ClipDto;
import com.cotune.clip.dto.UpdateClipInput;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.exception.StaleVersionException;
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
public class ClipServiceImpl implements ClipService {

    private final ClipRepository clipRepository;
    private final SongRepository songRepository;
    private final BeatRepository beatRepository;
    private final AudioFileRepository audioFileRepository;
    private final ClipMapper clipMapper;

    @Override
    public ClipDto add(AddClipInput input) {
        if (!songRepository.existsById(input.songId())) {
            throw ResourceNotFoundException.song(input.songId());
        }
        Song songRef = songRepository.getReferenceById(input.songId());

        // Exactly one reference decides the clip type. Rejecting both/none
        // here (not in the entity) keeps the message in API vocabulary.
        boolean hasBeat = input.beatId() != null;
        boolean hasAudio = input.audioId() != null;
        if (hasBeat == hasAudio) {
            throw new IllegalArgumentException(
                    "A clip places exactly one thing: set beatId (beat clip) OR audioId (audio clip)");
        }

        Clip clip;
        if (hasBeat) {
            // Same-song guard: placing another song's beat would make the
            // editor load material the song query never returns.
            if (!beatRepository.existsByIdAndSongId(input.beatId(), input.songId())) {
                throw ResourceNotFoundException.beat(input.beatId());
            }
            clip = Clip.forBeat(songRef, beatRepository.getReferenceById(input.beatId()),
                    input.lane(), input.startStep(), input.lengthSteps());
        } else {
            if (!audioFileRepository.existsByIdAndSongId(input.audioId(), input.songId())) {
                throw ResourceNotFoundException.audioFile(input.audioId());
            }
            // getReferenceById: FK-only proxy — crucially, this never loads
            // the audio bytes into memory just to place a clip.
            clip = Clip.forAudio(songRef, audioFileRepository.getReferenceById(input.audioId()),
                    input.lane(), input.startStep(), input.lengthSteps());
        }

        // saveAndFlush so @CreationTimestamp/@UpdateTimestamp are real
        // values in the returned DTO (see AudioServiceImpl.upload).
        return clipMapper.toDto(clipRepository.saveAndFlush(clip));
    }

    @Override
    public ClipDto update(UUID id, UpdateClipInput input) {
        Clip clip = clipRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.clip(id));
        StaleVersionException.check("Clip", input.expectedVersion(), clip.getVersion());

        // Managed entity + dirty checking (see SongServiceImpl.update).
        clip.place(input.lane(), input.startStep(), input.lengthSteps());

        clipRepository.flush();
        return clipMapper.toDto(clip);
    }

    @Override
    public void delete(UUID id) {
        if (!clipRepository.existsById(id)) {
            throw ResourceNotFoundException.clip(id);
        }
        clipRepository.deleteById(id);
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, List<ClipDto>> getBySongIds(List<UUID> songIds) {
        return clipRepository.findBySongIdInOrderByLaneAscStartStepAsc(songIds).stream()
                .collect(Collectors.groupingBy(
                        clip -> clip.getSong().getId(),
                        LinkedHashMap::new,
                        Collectors.mapping(clipMapper::toDto, Collectors.toList())));
    }
}
