package com.cotune.track;

import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.track.dto.AddTrackInput;
import com.cotune.track.dto.TrackDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service tested in isolation: repositories are Mockito mocks, so we test
 * OUR logic (position assignment, not-found handling) without a database.
 * This only works because the service depends on interfaces injected via
 * constructor — the payoff of that design, made concrete.
 *
 * Note the mapper is REAL, not mocked: it's a pure function with no I/O,
 * and mocking it would just restate its implementation in the test.
 */
@ExtendWith(MockitoExtension.class)
class TrackServiceImplTest {

    @Mock
    private TrackRepository trackRepository;

    @Mock
    private BeatRepository beatRepository;

    private TrackServiceImpl service;

    private final UUID beatId = UUID.randomUUID();
    private final Beat beat =
            new Beat(new Song("Test Song", 120, "4/4", UUID.randomUUID()), "Beat 1", 0);

    @BeforeEach
    void setUp() {
        service = new TrackServiceImpl(trackRepository, beatRepository, new TrackMapper());
    }

    @Test
    void addAssignsPositionAfterCurrentMax() {
        when(beatRepository.existsById(beatId)).thenReturn(true);
        when(beatRepository.getReferenceById(beatId)).thenReturn(beat);
        when(trackRepository.findMaxPositionByBeatId(beatId)).thenReturn(2);
        // Echo back the entity passed to saveAndFlush(), like the real repo would.
        when(trackRepository.saveAndFlush(any(Track.class))).thenAnswer(inv -> inv.getArgument(0));

        TrackDto dto = service.add(new AddTrackInput(beatId, "Lead Synth", Instrument.SYNTH));

        assertThat(dto.position()).isEqualTo(3);
        assertThat(dto.name()).isEqualTo("Lead Synth");
        assertThat(dto.instrument()).isEqualTo(Instrument.SYNTH);
    }

    @Test
    void addStartsAtPositionZeroForEmptyBeat() {
        when(beatRepository.existsById(beatId)).thenReturn(true);
        when(beatRepository.getReferenceById(beatId)).thenReturn(beat);
        // The COALESCE(..., -1) contract from the repository query.
        when(trackRepository.findMaxPositionByBeatId(beatId)).thenReturn(-1);
        when(trackRepository.saveAndFlush(any(Track.class))).thenAnswer(inv -> inv.getArgument(0));

        TrackDto dto = service.add(new AddTrackInput(beatId, "Drums", Instrument.DRUMS));

        assertThat(dto.position()).isZero();
    }

    @Test
    void addRejectsUnknownBeatBeforeTouchingTrackRepository() {
        when(beatRepository.existsById(beatId)).thenReturn(false);

        assertThatThrownBy(() -> service.add(new AddTrackInput(beatId, "Bass", Instrument.BASS)))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(beatId.toString());

        // Fail-fast means no partial work: nothing was saved.
        verify(trackRepository, never()).saveAndFlush(any());
    }

    @Test
    void updatePatternReplacesStepsAndRejectsInvalidOnes() {
        UUID trackId = UUID.randomUUID();
        Track track = new Track(beat, "Kick", Instrument.DRUMS, 0);
        when(trackRepository.findById(trackId)).thenReturn(java.util.Optional.of(track));

        TrackDto dto = service.updatePattern(trackId, java.util.List.of(
                new com.cotune.track.dto.StepInput(0, "C1", 0.9, 1),
                new com.cotune.track.dto.StepInput(8, "C1", 0.9, 4)));

        assertThat(dto.pattern()).hasSize(2);
        assertThat(dto.pattern().getFirst().pitch()).isEqualTo("C1");
        assertThat(dto.pattern().getLast().length()).isEqualTo(4);

        // Bad pitch is stopped by the Step value object itself — the domain
        // guarantee holds even if boundary validation were bypassed.
        assertThatThrownBy(() -> service.updatePattern(trackId, java.util.List.of(
                new com.cotune.track.dto.StepInput(0, "H4", 0.9, 1))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("pitch");

        // A note may not overrun the loop: step 14 + length 4 ends at 18.
        assertThatThrownBy(() -> service.updatePattern(trackId, java.util.List.of(
                new com.cotune.track.dto.StepInput(14, "C1", 0.9, 4))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("length");
    }

    @Test
    void updatePatternRejectsDuplicateEvents() {
        UUID trackId = UUID.randomUUID();
        Track track = new Track(beat, "Bass", Instrument.BASS, 0);
        when(trackRepository.findById(trackId)).thenReturn(java.util.Optional.of(track));

        assertThatThrownBy(() -> service.updatePattern(trackId, java.util.List.of(
                new com.cotune.track.dto.StepInput(3, "C2", 0.9, 1),
                new com.cotune.track.dto.StepInput(3, "C2", 0.5, 2))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("duplicate");
    }

    @Test
    void renameChangesNameAndNothingElse() {
        UUID trackId = UUID.randomUUID();
        Track track = new Track(beat, "Kick", Instrument.DRUMS, 2);
        when(trackRepository.findById(trackId)).thenReturn(java.util.Optional.of(track));

        TrackDto dto = service.rename(trackId, "  Kick 808  ");

        // The entity strips whitespace; instrument and position untouched.
        assertThat(dto.name()).isEqualTo("Kick 808");
        assertThat(dto.instrument()).isEqualTo(Instrument.DRUMS);
        assertThat(dto.position()).isEqualTo(2);
    }

    @Test
    void renameRejectsUnknownTrackAndBlankName() {
        UUID trackId = UUID.randomUUID();
        when(trackRepository.findById(trackId)).thenReturn(java.util.Optional.empty());

        assertThatThrownBy(() -> service.rename(trackId, "New Name"))
                .isInstanceOf(ResourceNotFoundException.class);

        // Blank is stopped by the entity's domain guard, even if Bean
        // Validation at the REST boundary were bypassed.
        Track track = new Track(beat, "Kick", Instrument.DRUMS, 0);
        when(trackRepository.findById(trackId)).thenReturn(java.util.Optional.of(track));
        assertThatThrownBy(() -> service.rename(trackId, "   "))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void deleteRejectsUnknownTrack() {
        UUID trackId = UUID.randomUUID();
        when(trackRepository.existsById(trackId)).thenReturn(false);

        assertThatThrownBy(() -> service.delete(trackId))
                .isInstanceOf(ResourceNotFoundException.class);

        verify(trackRepository, never()).deleteById(any());
    }
}
