package com.cotune.beat;

import com.cotune.beat.dto.AddBeatInput;
import com.cotune.beat.dto.BeatDto;
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
public class BeatServiceImpl implements BeatService {

    private final BeatRepository beatRepository;
    private final SongRepository songRepository;
    private final BeatMapper beatMapper;

    @Override
    public BeatDto add(AddBeatInput input) {
        // Same idiom as every child-creation service: existence check for
        // a clean NOT_FOUND, lazy reference for the FK, append-at-end
        // position with the UNIQUE constraint as the race referee.
        if (!songRepository.existsById(input.songId())) {
            throw ResourceNotFoundException.song(input.songId());
        }
        Song songRef = songRepository.getReferenceById(input.songId());
        int nextPosition = beatRepository.findMaxPositionBySongId(input.songId()) + 1;

        Beat saved = beatRepository.saveAndFlush(new Beat(songRef, input.name(), nextPosition));
        return beatMapper.toDto(saved);
    }

    @Override
    public BeatDto rename(UUID id, String name) {
        Beat beat = beatRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.beat(id));
        // Managed entity + dirty checking — no save(); flush so the DTO
        // carries the bumped version/updatedAt (see SongServiceImpl.update).
        beat.rename(name);
        beatRepository.flush();
        return beatMapper.toDto(beat);
    }

    @Override
    public void delete(UUID id) {
        if (!beatRepository.existsById(id)) {
            throw ResourceNotFoundException.beat(id);
        }
        // ON DELETE CASCADE (V7) sweeps the beat's lanes AND its clip
        // placements — deleting "Beat 2" removes it from the timeline too.
        beatRepository.deleteById(id);
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, List<BeatDto>> getBySongIds(List<UUID> songIds) {
        return beatRepository.findBySongIdInOrderByPositionAsc(songIds).stream()
                .collect(Collectors.groupingBy(
                        beat -> beat.getSong().getId(),
                        LinkedHashMap::new,
                        Collectors.mapping(beatMapper::toDto, Collectors.toList())));
    }
}
