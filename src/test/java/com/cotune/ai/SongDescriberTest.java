package com.cotune.ai;

import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import com.cotune.track.Instrument;
import com.cotune.track.Step;
import com.cotune.track.Track;
import com.cotune.track.TrackRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The grid rendering is the part of the AI feature with actual logic in it
 * — the model's advice is only as good as the text it reads, and an
 * off-by-one here would have the mentor confidently discussing hits that
 * aren't there. Rendering is asserted character-by-character on purpose.
 */
@ExtendWith(MockitoExtension.class)
class SongDescriberTest {

    @Mock
    private SongRepository songRepository;
    @Mock
    private BeatRepository beatRepository;
    @Mock
    private TrackRepository trackRepository;
    @InjectMocks
    private SongDescriber describer;

    private final UUID songId = UUID.randomUUID();

    private Song song() {
        Song song = new Song("Night Drive", 92, "4/4", UUID.randomUUID());
        ReflectionTestUtils.setField(song, "id", songId);
        return song;
    }

    @Test
    void rendersHitsHeldTailsAndSilencePerStep() {
        Song song = song();
        Beat beat = new Beat(song, "Beat 1", 0);
        ReflectionTestUtils.setField(beat, "id", UUID.randomUUID());
        Track kick = new Track(beat, "Kick", Instrument.DRUMS, 0);
        // A hit on 0, a held 3-step note on 4 (tail on 5 and 6), a hit on 12.
        kick.replacePattern(List.of(
                new Step(0, "C4", 0.9, 1),
                new Step(4, "C4", 0.9, 3),
                new Step(12, "E4", 0.9, 1)));

        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        when(beatRepository.findBySongIdInOrderByPositionAsc(any())).thenReturn(List.of(beat));
        when(trackRepository.findByBeatIdInOrderByPositionAsc(any())).thenReturn(List.of(kick));

        String text = describer.describe(songId);

        assertThat(text).contains("Night Drive").contains("92 BPM");
        // The whole point, character by character: x at 0, silence, held
        // note x—— from 4, silence, x at 12, silence to the bar line.
        assertThat(text).contains("|x...x——.....x...|");
        // The pitch SET rides along (deduplicated), not per-note pitches.
        assertThat(text).contains("pitches: C4 E4");
    }

    @Test
    void aTwoBarBeatGetsABarSeparatorBetweenItsBars() {
        Song song = song();
        Beat beat = new Beat(song, "Long One", 0);
        beat.changeBars(2);
        ReflectionTestUtils.setField(beat, "id", UUID.randomUUID());
        Track hats = new Track(beat, "Hats", Instrument.DRUMS, 0);
        // The domain itself forbids notes held past the beat's end (Track
        // rejects them), so the describer's clipping is pure defence — the
        // legal edge to pin is a note on the very LAST step.
        hats.replacePattern(List.of(
                new Step(16, "F#5", 0.5, 1), // first step of bar 2
                new Step(31, "F#5", 0.5, 1)  // the final step
        ));

        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        when(beatRepository.findBySongIdInOrderByPositionAsc(any())).thenReturn(List.of(beat));
        when(trackRepository.findByBeatIdInOrderByPositionAsc(any())).thenReturn(List.of(hats));

        String text = describer.describe(songId);

        assertThat(text).contains("(2 bars, 16 steps per bar)");
        assertThat(text).contains("|................|x..............x|");
    }

    @Test
    void anEmptySongStillDescribesItselfInsteadOfReturningNothing() {
        when(songRepository.findById(songId)).thenReturn(Optional.of(song()));
        when(beatRepository.findBySongIdInOrderByPositionAsc(any())).thenReturn(List.of());
        when(trackRepository.findByBeatIdInOrderByPositionAsc(any())).thenReturn(List.of());

        // The model must be told the song is empty — handing it blank text
        // would invite hallucinated advice about beats that don't exist.
        assertThat(describer.describe(songId)).contains("No beats yet");
    }
}
