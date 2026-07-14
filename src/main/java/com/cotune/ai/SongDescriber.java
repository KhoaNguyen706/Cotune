package com.cotune.ai;

import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import com.cotune.track.Step;
import com.cotune.track.Track;
import com.cotune.track.TrackRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Renders a song as compact text a model can reason about — the same trick
 * as reading a drum machine's grid printout. Notes become one x/./— line
 * per lane (x = hit, — = a held note's tail), because "where the hits land
 * relative to each other" IS the musical content; velocities and exact
 * pitches would triple the tokens for advice that rarely needs them, so
 * only the pitch set per lane rides along.
 *
 * Cross-feature READS of beat and track data, same as BeatServiceImpl's
 * shrink guard — reading another feature's rows is allowed, writing is not.
 */
@Component
@RequiredArgsConstructor
public class SongDescriber {

    private final SongRepository songRepository;
    private final BeatRepository beatRepository;
    private final TrackRepository trackRepository;

    @Transactional(readOnly = true)
    public String describe(UUID songId) {
        Song song = songRepository.findById(songId)
                .orElseThrow(() -> ResourceNotFoundException.song(songId));
        List<Beat> beats = beatRepository.findBySongIdInOrderByPositionAsc(List.of(songId));
        Map<UUID, List<Track>> lanesByBeat = trackRepository
                .findByBeatIdInOrderByPositionAsc(beats.stream().map(Beat::getId).toList())
                .stream()
                .collect(Collectors.groupingBy(track -> track.getBeat().getId()));

        StringBuilder text = new StringBuilder();
        text.append("Song \"%s\" — %d BPM, %s.%n"
                .formatted(song.getTitle(), song.getBpm(), song.getTimeSignature()));
        if (beats.isEmpty()) {
            text.append("No beats yet — the song is empty.%n".formatted());
        }
        for (Beat beat : beats) {
            text.append("%nBeat \"%s\" (%d bar%s, 16 steps per bar):%n"
                    .formatted(beat.getName(), beat.getBars(), beat.getBars() > 1 ? "s" : ""));
            List<Track> lanes = lanesByBeat.getOrDefault(beat.getId(), List.of());
            if (lanes.isEmpty()) {
                text.append("  (no lanes yet)%n".formatted());
            }
            for (Track lane : lanes) {
                text.append("  %s [%s]: %s  pitches: %s%n".formatted(
                        lane.getName(),
                        lane.getInstrument(),
                        grid(lane.getPattern(), beat.totalSteps()),
                        pitchSet(lane.getPattern())));
            }
        }
        return text.toString();
    }

    /** One character per step: x = a note starts, — = a held note's tail,
     *  . = silence. A bar separator every 16 steps keeps long beats legible. */
    private static String grid(List<Step> pattern, int totalSteps) {
        char[] cells = new char[totalSteps];
        java.util.Arrays.fill(cells, '.');
        for (Step note : pattern) {
            if (note.step() >= totalSteps) {
                continue; // defensive: never let a stray row break advice
            }
            cells[note.step()] = 'x';
            for (int tail = note.step() + 1;
                 tail < Math.min(note.step() + note.length(), totalSteps); tail++) {
                if (cells[tail] == '.') {
                    cells[tail] = '—';
                }
            }
        }
        StringBuilder out = new StringBuilder("|");
        for (int i = 0; i < totalSteps; i++) {
            out.append(cells[i]);
            if ((i + 1) % 16 == 0) {
                out.append('|');
            }
        }
        return out.toString();
    }

    private static String pitchSet(List<Step> pattern) {
        if (pattern.isEmpty()) {
            return "(empty)";
        }
        return pattern.stream().map(Step::pitch).distinct().sorted()
                .collect(Collectors.joining(" "));
    }
}
