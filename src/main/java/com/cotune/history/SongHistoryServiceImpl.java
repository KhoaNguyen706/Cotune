package com.cotune.history;

import com.cotune.common.mapping.Timestamps;
import com.cotune.history.dto.SongEventDto;
import com.cotune.track.Step;
import com.cotune.track.Track;
import com.cotune.track.TrackRepository;
import com.cotune.user.User;
import com.cotune.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SongHistoryServiceImpl implements SongHistoryService {

    /** History pages stay readable; deeper digs page again (client passes
     *  a smaller-than-cap limit; the cap is the server's own guard). */
    static final int MAX_LIMIT = 200;

    private final SongEventRepository songEventRepository;
    // Cross-feature READS for name resolution — the same allowance
    // SongDescriber uses; writing other features' tables stays forbidden.
    private final TrackRepository trackRepository;
    private final UserRepository userRepository;

    // ---- recording (called inside the edit's transaction) -----------------
    // No @Transactional here on purpose: these are invoked BY transactional
    // service methods (TrackServiceImpl) and must join that transaction, so
    // the event and the edit are one atomic fact. Called standalone they'd
    // still get a transaction from the repository save.

    @Override
    public void recordNoteAdd(UUID songId, UUID trackId, UUID actorId, Step note) {
        songEventRepository.save(
                new SongEvent(songId, trackId, actorId, SongEventType.NOTE_ADD, List.of(note)));
    }

    @Override
    public void recordNoteRemove(UUID songId, UUID trackId, UUID actorId, Step note) {
        songEventRepository.save(
                new SongEvent(songId, trackId, actorId, SongEventType.NOTE_REMOVE, List.of(note)));
    }

    @Override
    public void recordPatternSet(UUID songId, UUID trackId, UUID actorId, List<Step> pattern) {
        songEventRepository.save(
                new SongEvent(songId, trackId, actorId, SongEventType.PATTERN_SET, pattern));
    }

    // ---- reading -----------------------------------------------------------

    @Override
    @Transactional(readOnly = true)
    public List<SongEventDto> history(UUID songId, int limit) {
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new IllegalArgumentException(
                    "limit must be 1..%d, got %d".formatted(MAX_LIMIT, limit));
        }
        List<SongEvent> events = songEventRepository
                .findBySongIdOrderByIdDesc(songId, PageRequest.of(0, limit));

        // Resolve names in TWO queries, not 2N: collect ids, batch-load,
        // join in memory — same N+1 discipline as the GraphQL resolvers.
        Map<UUID, String> trackNames = trackRepository.findAllById(
                        events.stream().map(SongEvent::getTrackId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(Track::getId, Track::getName));
        Map<UUID, String> actorNames = userRepository.findAllById(
                        events.stream().map(SongEvent::getActorId)
                                .filter(Objects::nonNull).distinct().toList())
                .stream()
                .collect(Collectors.toMap(User::getId, User::getDisplayName));

        return events.stream()
                .map(event -> new SongEventDto(
                        String.valueOf(event.getId()),
                        event.getTrackId(),
                        trackNames.get(event.getTrackId()),           // null = deleted lane
                        event.getActorId() == null
                                ? null                                 // the baseline
                                : actorNames.getOrDefault(event.getActorId(), "a deleted account"),
                        event.getType(),
                        summarize(event),
                        Timestamps.utc(event.getCreatedAt())))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<Step> patternAt(UUID trackId, long eventId) {
        return replay(songEventRepository
                .findByTrackIdAndIdLessThanEqualOrderByIdAsc(trackId, eventId));
    }

    /**
     * The fold. A lane is born empty; PATTERN_SET replaces the state,
     * NOTE_ADD upserts by step+pitch (the same identity applyNote merges
     * on), NOTE_REMOVE deletes by it. Because every write path logs, the
     * fold of a lane's events IS the lane at that moment — no diffs, no
     * inverse operations, no stored snapshots to invalidate.
     */
    static List<Step> replay(List<SongEvent> events) {
        List<Step> state = new ArrayList<>();
        for (SongEvent event : events) {
            switch (event.getType()) {
                case PATTERN_SET -> state = new ArrayList<>(event.getPayload());
                case NOTE_ADD -> {
                    Step note = event.getPayload().getFirst();
                    state.removeIf(s -> s.step() == note.step() && s.pitch().equals(note.pitch()));
                    state.add(note);
                }
                case NOTE_REMOVE -> {
                    Step note = event.getPayload().getFirst();
                    state.removeIf(s -> s.step() == note.step() && s.pitch().equals(note.pitch()));
                }
            }
        }
        return state;
    }

    /** The one human sentence per event, told the same way everywhere. */
    private static String summarize(SongEvent event) {
        return switch (event.getType()) {
            case NOTE_ADD -> {
                Step note = event.getPayload().getFirst();
                yield "added %s at step %d".formatted(note.pitch(), note.step());
            }
            case NOTE_REMOVE -> {
                Step note = event.getPayload().getFirst();
                yield "removed %s from step %d".formatted(note.pitch(), note.step());
            }
            case PATTERN_SET -> {
                int notes = event.getPayload().size();
                if (event.getActorId() == null) {
                    yield "the grid when history began (%d note%s)"
                            .formatted(notes, notes == 1 ? "" : "s");
                }
                yield notes == 0
                        ? "cleared the lane"
                        : "replaced the grid (%d note%s)".formatted(notes, notes == 1 ? "" : "s");
            }
        };
    }
}
