package com.cotune.track;

import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.history.SongHistoryService;
import com.cotune.common.exception.StaleVersionException;
import com.cotune.track.dto.AddTrackInput;
import com.cotune.track.dto.NoteApplied;
import com.cotune.track.dto.NoteOp;
import com.cotune.track.dto.StepInput;
import com.cotune.track.dto.TrackDto;
import com.cotune.track.dto.UpdateTrackInput;
import com.cotune.track.dto.UpdateTrackPatch;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
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
    // Cross-feature dependency on the history SERVICE (not its table):
    // every pattern write reports itself, inside its own transaction, so
    // the log and the lane commit or roll back together.
    private final SongHistoryService songHistoryService;

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
    public TrackDto patch(UUID id, UpdateTrackPatch patch) {
        if (patch.isEmpty()) {
            throw new IllegalArgumentException("Patch must change at least one field");
        }
        Track track = loadTrack(id);
        if (patch.name() != null) {
            track.rename(patch.name());
        }
        if (patch.volume() != null) {
            track.changeVolume(patch.volume());
        }
        if (patch.pan() != null) {
            track.changePan(patch.pan());
        }
        trackRepository.flush();
        return trackMapper.toDto(track);
    }

    @Override
    public NoteApplied applyNote(UUID songId, UUID trackId, NoteOp op, UUID actorId) {
        // AUTHORIZATION DEPENDS ON THIS LINE. The caller proved they may edit
        // `songId` (@PreAuthorize on the message handler), but trackId came
        // from the message body — an attacker with an editor seat on their own
        // throwaway song could otherwise name any lane in the database here and
        // have us happily write to it. Confusing "the id I checked" with "the
        // id I acted on" is one of the most common authorization bugs there is.
        UUID owningSong = trackRepository.findSongIdById(trackId)
                .orElseThrow(() -> ResourceNotFoundException.track(trackId));
        if (!owningSong.equals(songId)) {
            throw new AccessDeniedException("Track " + trackId + " does not belong to song " + songId);
        }

        // FOR UPDATE: this is a read-modify-write, and two collaborators
        // hitting the same lane at the same instant would otherwise each read
        // the pre-change pattern and each write it back with only their own
        // note — the exact silent overwrite that deltas exist to prevent. The
        // lock makes the pair serial, so both notes land.
        Track track = trackRepository.findByIdForUpdate(trackId)
                .orElseThrow(() -> ResourceNotFoundException.track(trackId));

        // Merge by IDENTITY, which for a note is (step, pitch) — the same key
        // Track.replacePattern refuses duplicates on. Removing that key first
        // makes ADD an upsert and makes both ops idempotent: re-applying either
        // one leaves the lane exactly as it was, so a client that retries an op
        // it wasn't sure landed cannot corrupt anything.
        //
        // The note at that key — as it actually was — is captured first,
        // because history (V15) needs it: a remove op only identifies
        // step+pitch, but "removed C2 (soft, 2 steps)" is what the log
        // should say, and only the server saw the note before it died.
        Step existing = track.getPattern().stream()
                .filter(note -> note.step() == op.step() && note.pitch().equals(op.pitch()))
                .findFirst()
                .orElse(null);
        List<Step> merged = new ArrayList<>(track.getPattern());
        merged.removeIf(note -> note.step() == op.step() && note.pitch().equals(op.pitch()));
        if (op.type() == NoteOpType.ADD) {
            // Step's constructor re-validates pitch/velocity/length, and
            // replacePattern re-checks the note fits the beat's bar count.
            // A hostile op cannot write a note the REST/GraphQL path would
            // have rejected — the domain rules sit BELOW the transport, so
            // adding a new transport cannot bypass them.
            Step added = new Step(op.step(), op.pitch(), op.velocity(), op.length());
            merged.add(added);
            // Idempotent retries stay invisible: re-adding the identical
            // note changes nothing, so history says nothing.
            if (!added.equals(existing)) {
                songHistoryService.recordNoteAdd(songId, trackId, actorId, added);
            }
        } else if (existing != null) {
            songHistoryService.recordNoteRemove(songId, trackId, actorId, existing);
        }
        track.replacePattern(merged);

        // Flush inside the lock so the version we broadcast is the version that
        // is actually committed, not one the next op will invalidate.
        trackRepository.flush();
        return new NoteApplied(trackId, track.getVersion());
    }

    @Override
    public TrackDto updatePattern(UUID id, List<StepInput> pattern, Long expectedVersion, UUID actorId) {
        Track track = loadTrack(id);
        StaleVersionException.check("Track pattern", expectedVersion, track.getVersion());

        // DTO -> domain value objects. Each Step's compact constructor
        // re-validates; a malformed event can't sneak past the boundary
        // even if a future caller skips Bean Validation.
        List<Step> steps = pattern.stream()
                .map(input -> new Step(input.step(), input.pitch(), input.velocity(), input.length()))
                .toList();
        track.replacePattern(steps);

        // History (V15): one PATTERN_SET per whole-grid save, in the same
        // transaction — the log and the lane can't disagree. Recorded
        // AFTER replacePattern so a rejected grid never enters history.
        UUID songId = trackRepository.findSongIdById(id)
                .orElseThrow(() -> ResourceNotFoundException.track(id));
        songHistoryService.recordPatternSet(songId, id, actorId, steps);

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
