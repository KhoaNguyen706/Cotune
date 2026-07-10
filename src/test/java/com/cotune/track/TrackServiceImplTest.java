package com.cotune.track;

import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
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
    private SongRepository songRepository;

    private TrackServiceImpl service;

    private final UUID songId = UUID.randomUUID();
    private final Song song = new Song("Test Song", 120, "4/4");

    @BeforeEach
    void setUp() {
        service = new TrackServiceImpl(trackRepository, songRepository, new TrackMapper());
    }

    @Test
    void addAssignsPositionAfterCurrentMax() {
        when(songRepository.existsById(songId)).thenReturn(true);
        when(songRepository.getReferenceById(songId)).thenReturn(song);
        when(trackRepository.findMaxPositionBySongId(songId)).thenReturn(2);
        // Echo back the entity passed to save(), like the real repo would.
        when(trackRepository.save(any(Track.class))).thenAnswer(inv -> inv.getArgument(0));

        TrackDto dto = service.add(new AddTrackInput(songId, "Lead Synth", Instrument.SYNTH));

        assertThat(dto.position()).isEqualTo(3);
        assertThat(dto.name()).isEqualTo("Lead Synth");
        assertThat(dto.instrument()).isEqualTo(Instrument.SYNTH);
    }

    @Test
    void addStartsAtPositionZeroForEmptySong() {
        when(songRepository.existsById(songId)).thenReturn(true);
        when(songRepository.getReferenceById(songId)).thenReturn(song);
        // The COALESCE(..., -1) contract from the repository query.
        when(trackRepository.findMaxPositionBySongId(songId)).thenReturn(-1);
        when(trackRepository.save(any(Track.class))).thenAnswer(inv -> inv.getArgument(0));

        TrackDto dto = service.add(new AddTrackInput(songId, "Drums", Instrument.DRUMS));

        assertThat(dto.position()).isZero();
    }

    @Test
    void addRejectsUnknownSongBeforeTouchingTrackRepository() {
        when(songRepository.existsById(songId)).thenReturn(false);

        assertThatThrownBy(() -> service.add(new AddTrackInput(songId, "Bass", Instrument.BASS)))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(songId.toString());

        // Fail-fast means no partial work: nothing was saved.
        verify(trackRepository, never()).save(any());
    }

    @Test
    void updatePatternReplacesStepsAndRejectsInvalidOnes() {
        UUID trackId = UUID.randomUUID();
        Track track = new Track(song, "Kick", Instrument.DRUMS, 0);
        when(trackRepository.findById(trackId)).thenReturn(java.util.Optional.of(track));

        TrackDto dto = service.updatePattern(trackId, java.util.List.of(
                new com.cotune.track.dto.StepInput(0, "C1", 0.9),
                new com.cotune.track.dto.StepInput(8, "C1", 0.9)));

        assertThat(dto.pattern()).hasSize(2);
        assertThat(dto.pattern().getFirst().pitch()).isEqualTo("C1");

        // Bad pitch is stopped by the Step value object itself — the domain
        // guarantee holds even if boundary validation were bypassed.
        assertThatThrownBy(() -> service.updatePattern(trackId, java.util.List.of(
                new com.cotune.track.dto.StepInput(0, "H4", 0.9))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("pitch");
    }

    @Test
    void updatePatternRejectsDuplicateEvents() {
        UUID trackId = UUID.randomUUID();
        Track track = new Track(song, "Bass", Instrument.BASS, 0);
        when(trackRepository.findById(trackId)).thenReturn(java.util.Optional.of(track));

        assertThatThrownBy(() -> service.updatePattern(trackId, java.util.List.of(
                new com.cotune.track.dto.StepInput(3, "C2", 0.9),
                new com.cotune.track.dto.StepInput(3, "C2", 0.5))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("duplicate");
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
