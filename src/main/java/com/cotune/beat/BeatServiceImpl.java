package com.cotune.beat;

import com.cotune.beat.dto.AddBeatInput;
import com.cotune.beat.dto.BeatDto;
import com.cotune.beat.dto.UpdateBeatPatch;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.exception.StaleVersionException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import com.cotune.track.TrackRepository;
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
    // Cross-feature READ (see TrackServiceImpl's note): the shrink guard
    // must see the lanes' patterns, and they live in the track feature.
    private final TrackRepository trackRepository;
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
    public BeatDto patch(UUID id, UpdateBeatPatch patch) {
        if (patch.isEmpty()) {
            throw new IllegalArgumentException("Patch must change at least one field");
        }
        Beat beat = beatRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.beat(id));
        StaleVersionException.check("Beat", patch.expectedVersion(), beat.getVersion());

        if (patch.name() != null) {
            beat.rename(patch.name());
        }
        if (patch.bars() != null && patch.bars() != beat.getBars()) {
            // Shrink guard: silently truncating stored notes would be data
            // loss; making them unreachable-but-stored would desync grid
            // and playback. Refuse and tell the user what's in the way.
            int lastUsedStep = lastUsedStep(id);
            if (patch.bars() * 16 < lastUsedStep) {
                throw new IllegalArgumentException(
                        "Cannot shrink to %d bar(s): a lane has notes up to step %d — delete them first"
                                .formatted(patch.bars(), lastUsedStep));
            }
            beat.changeBars(patch.bars());
        }
        // Managed entity + dirty checking — no save(); flush so the DTO
        // carries the bumped version/updatedAt (see SongServiceImpl.update).
        beatRepository.flush();
        return beatMapper.toDto(beat);
    }

    /** Highest note END (step + length) across all of the beat's lanes. */
    private int lastUsedStep(UUID beatId) {
        return trackRepository.findByBeatIdInOrderByPositionAsc(java.util.List.of(beatId)).stream()
                .flatMap(track -> track.getPattern().stream())
                .mapToInt(step -> step.step() + step.length())
                .max()
                .orElse(0);
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
