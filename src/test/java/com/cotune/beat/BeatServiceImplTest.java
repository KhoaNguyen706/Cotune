package com.cotune.beat;

import com.cotune.beat.dto.BeatDto;
import com.cotune.beat.dto.UpdateBeatPatch;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import com.cotune.track.Instrument;
import com.cotune.track.Step;
import com.cotune.track.Track;
import com.cotune.track.TrackRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * Same isolation recipe as TrackServiceImplTest: mocked repositories,
 * real mapper (pure function).
 */
@ExtendWith(MockitoExtension.class)
class BeatServiceImplTest {

    @Mock
    private BeatRepository beatRepository;

    @Mock
    private SongRepository songRepository;

    @Mock
    private TrackRepository trackRepository;

    private BeatServiceImpl service;

    private final Song song = new Song("Test Song", 120, "4/4", UUID.randomUUID());

    @BeforeEach
    void setUp() {
        service = new BeatServiceImpl(beatRepository, songRepository, trackRepository, new BeatMapper());
    }

    @Test
    void patchRenamesAndKeepsPosition() {
        UUID beatId = UUID.randomUUID();
        Beat beat = new Beat(song, "Beat 1", 3);
        when(beatRepository.findById(beatId)).thenReturn(Optional.of(beat));

        BeatDto dto = service.patch(beatId, new UpdateBeatPatch("  Drop  ", null, null));

        assertThat(dto.name()).isEqualTo("Drop");
        assertThat(dto.position()).isEqualTo(3);
        assertThat(dto.bars()).isEqualTo(1);
    }

    @Test
    void patchRejectsUnknownBeatBlankNameAndEmptyPatch() {
        UUID beatId = UUID.randomUUID();
        when(beatRepository.findById(beatId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.patch(beatId, new UpdateBeatPatch("Drop", null, null)))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(beatId.toString());

        assertThatThrownBy(() -> service.patch(beatId, new UpdateBeatPatch(null, null, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at least one field");

        Beat beat = new Beat(song, "Beat 1", 0);
        when(beatRepository.findById(beatId)).thenReturn(Optional.of(beat));
        assertThatThrownBy(() -> service.patch(beatId, new UpdateBeatPatch("   ", null, null)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void patchGrowsBarsAndRefusesShrinkPastExistingNotes() {
        UUID beatId = UUID.randomUUID();
        Beat beat = new Beat(song, "Beat 1", 0);
        when(beatRepository.findById(beatId)).thenReturn(Optional.of(beat));
        when(trackRepository.findByBeatIdInOrderByPositionAsc(List.of(beatId)))
                .thenReturn(List.of());

        // Growing always works (no notes can be cut).
        assertThat(service.patch(beatId, new UpdateBeatPatch(null, 4, null)).bars()).isEqualTo(4);

        // A lane with a note ending at step 40 blocks shrinking to 2 bars
        // (32 steps) but not to 3 (48 steps).
        Track lane = new Track(beat, "Kick", Instrument.DRUMS, 0);
        lane.replacePattern(List.of(new Step(39, "C2", 0.9, 1)));
        when(trackRepository.findByBeatIdInOrderByPositionAsc(List.of(beatId)))
                .thenReturn(List.of(lane));

        assertThatThrownBy(() -> service.patch(beatId, new UpdateBeatPatch(null, 2, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("shrink");
        assertThat(service.patch(beatId, new UpdateBeatPatch(null, 3, null)).bars()).isEqualTo(3);

        // Out-of-range bars is stopped by the entity guard.
        assertThatThrownBy(() -> service.patch(beatId, new UpdateBeatPatch(null, 9, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("bars");
    }
}
