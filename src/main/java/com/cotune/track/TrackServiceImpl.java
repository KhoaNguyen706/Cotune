package com.cotune.track;

import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.track.dto.AddTrackInput;
import com.cotune.track.dto.StepInput;
import com.cotune.track.dto.TrackDto;
import com.cotune.track.dto.UpdateTrackInput;
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
public class TrackServiceImpl implements TrackService {

    private final TrackRepository trackRepository;
    // A service may depend on ANOTHER feature's repository (or better, its
    // service) — cross-feature reads are normal; what's forbidden is
    // reaching into another feature's tables with raw SQL.
    private final BeatRepository beatRepository;
    private final TrackMapper trackMapper;

    @Override
    public TrackDto add(AddTrackInput input) {
        // Explicit existence check so a bogus beatId becomes a clean
        // NOT_FOUND now — otherwise it would surface at flush time as a
        // cryptic FK-violation 500.
        if (!beatRepository.existsById(input.beatId())) {
            throw ResourceNotFoundException.beat(input.beatId());
        }

        // getReferenceById returns a lazy PROXY without any SELECT — we
        // only need the Beat to fill the FK column, so loading the full
        // row (findById) would be a wasted query. This is the standard
        // "attach child to parent by id" idiom.
        Beat beatRef = beatRepository.getReferenceById(input.beatId());

        // Append-at-end. NOTE a real race lives here: two concurrent adds
        // to the same beat can both read max=2 and both try position 3.
        // The UNIQUE (beat_id, position) constraint turns that race into a
        // hard failure instead of silent corruption — the DB is the last
        // referee. Proper serialization of concurrent edits is exactly
        // what the collaboration sessions will address.
        int nextPosition = trackRepository.findMaxPositionByBeatId(input.beatId()) + 1;

        Track saved = trackRepository.saveAndFlush(
                new Track(beatRef, input.name(), input.instrument(), nextPosition));
        return trackMapper.toDto(saved);
    }

    @Override
    public TrackDto update(UUID id, UpdateTrackInput input) {
        Track track = loadTrack(id);

        // Managed entity + dirty checking again — no save() call. See
        // SongServiceImpl.update for the full explanation.
        track.rename(input.name());
        track.changeInstrument(input.instrument());

        trackRepository.flush();
        return trackMapper.toDto(track);
    }

    @Override
    public TrackDto rename(UUID id, String name) {
        Track track = loadTrack(id);
        track.rename(name);
        trackRepository.flush();
        return trackMapper.toDto(track);
    }

    @Override
    public TrackDto updatePattern(UUID id, List<StepInput> pattern) {
        Track track = loadTrack(id);

        // DTO -> domain value objects. Each Step's compact constructor
        // re-validates; a malformed event can't sneak past the boundary
        // even if a future caller skips Bean Validation.
        List<Step> steps = pattern.stream()
                .map(input -> new Step(input.step(), input.pitch(), input.velocity(), input.length()))
                .toList();
        track.replacePattern(steps);

        // Managed entity + dirty checking persists the JSONB column; flush
        // now so the returned DTO carries the bumped version/updatedAt
        // (same reasoning as update() above).
        trackRepository.flush();
        return trackMapper.toDto(track);
    }

    @Override
    public void delete(UUID id) {
        if (!trackRepository.existsById(id)) {
            throw ResourceNotFoundException.track(id);
        }
        // Leaves a gap in the position sequence (0,1,3...) — deliberate.
        // Order is still well-defined (ORDER BY position), and renumbering
        // siblings here would silently bump THEIR @Version counters,
        // creating phantom conflicts for collaborators editing those tracks.
        trackRepository.deleteById(id);
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, List<TrackDto>> getByBeatIds(List<UUID> beatIds) {
        // ONE query for all requested beats (WHERE beat_id IN ...) — the
        // whole point of the batch contract. groupingBy with LinkedHashMap
        // + toList preserves the ORDER BY position ordering per beat.
        return trackRepository.findByBeatIdInOrderByPositionAsc(beatIds).stream()
                .collect(Collectors.groupingBy(
                        track -> track.getBeat().getId(),
                        LinkedHashMap::new,
                        Collectors.mapping(trackMapper::toDto, Collectors.toList())));
    }

    private Track loadTrack(UUID id) {
        return trackRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.track(id));
    }
}
