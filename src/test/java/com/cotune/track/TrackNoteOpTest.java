package com.cotune.track;

import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.track.dto.NoteApplied;
import com.cotune.track.dto.NoteOp;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * The MERGE — the one behaviour that decides whether real-time editing works
 * or silently eats people's notes.
 *
 * Every test here is really the same test asked from a different angle: "does
 * an edit that arrives on top of someone else's edit keep BOTH?" The old
 * whole-pattern save cannot pass a single one of them, which is precisely why
 * session 16 put deltas on the wire.
 */
@ExtendWith(MockitoExtension.class)
class TrackNoteOpTest {

    @Mock
    private TrackRepository trackRepository;
    @Mock
    private BeatRepository beatRepository;

    private TrackServiceImpl service;

    private final UUID songId = UUID.randomUUID();
    private final UUID trackId = UUID.randomUUID();
    private Track track;

    @BeforeEach
    void setUp() {
        service = new TrackServiceImpl(trackRepository, beatRepository, new TrackMapper());

        Song song = new Song("Test Song", 120, "4/4", UUID.randomUUID());
        ReflectionTestUtils.setField(song, "id", songId);
        Beat beat = new Beat(song, "Beat 1", 0);
        track = new Track(beat, "Lead", Instrument.SYNTH, 0);

        lenient().when(trackRepository.findSongIdById(trackId)).thenReturn(Optional.of(songId));
        lenient().when(trackRepository.findByIdForUpdate(trackId)).thenReturn(Optional.of(track));
    }

    private static NoteOp add(UUID trackId, int step, String pitch) {
        return new NoteOp(NoteOpType.ADD, trackId, step, pitch, 0.9, 1);
    }

    private static NoteOp remove(UUID trackId, int step, String pitch) {
        return new NoteOp(NoteOpType.REMOVE, trackId, step, pitch, 0, 0);
    }

    // ---- the point of the whole session ------------------------------------

    @Test
    void twoEditorsAddingDifferentNotesToOneLaneBothSurvive() {
        // Alice adds a kick; Bob — who has never heard of it — adds a snare.
        service.applyNote(songId, trackId, add(trackId, 0, "C3"));
        service.applyNote(songId, trackId, add(trackId, 8, "E3"));

        // With whole-pattern saves, Bob's array (built from a snapshot taken
        // before Alice's note existed) would have overwritten the lane and
        // C3 would be GONE. A delta cannot express "and delete everything I
        // haven't heard about", so both notes are simply there.
        assertThat(track.getPattern())
                .extracting(Step::pitch)
                .containsExactlyInAnyOrder("C3", "E3");
    }

    @Test
    void aRemovalOnlyTakesTheNoteItNames() {
        service.applyNote(songId, trackId, add(trackId, 0, "C3"));
        service.applyNote(songId, trackId, add(trackId, 8, "E3"));

        service.applyNote(songId, trackId, remove(trackId, 0, "C3"));

        assertThat(track.getPattern()).extracting(Step::pitch).containsExactly("E3");
    }

    // ---- idempotency: what makes a re-send safe ----------------------------

    @Test
    void addingTheSameNoteTwiceUpsertsRatherThanDuplicating() {
        service.applyNote(songId, trackId, add(trackId, 4, "G3"));
        // Same key (step 4, G3), louder and longer. A client re-sending an op
        // it wasn't sure had landed must not be able to corrupt the lane —
        // and Track.replacePattern would REJECT an outright duplicate anyway.
        service.applyNote(songId, trackId, new NoteOp(NoteOpType.ADD, trackId, 4, "G3", 0.4, 3));

        assertThat(track.getPattern()).singleElement().satisfies(note -> {
            assertThat(note.velocity()).isEqualTo(0.4);
            assertThat(note.length()).isEqualTo(3);
        });
    }

    @Test
    void removingANoteThatIsNotThereIsNotAnError() {
        // Two people delete the same note at once; the second removal arrives
        // to find nothing. Erroring would surface a scary message for an
        // outcome the user already wanted.
        service.applyNote(songId, trackId, remove(trackId, 2, "D3"));

        assertThat(track.getPattern()).isEmpty();
    }

    @Test
    void aMoveIsARemovalPlusAnAdditionAndLeavesOneNote() {
        service.applyNote(songId, trackId, add(trackId, 0, "C3"));

        // Dragging C3 from step 0 to step 4 — the client diff emits exactly
        // these two ops, in this order.
        service.applyNote(songId, trackId, remove(trackId, 0, "C3"));
        service.applyNote(songId, trackId, add(trackId, 4, "C3"));

        assertThat(track.getPattern()).singleElement()
                .satisfies(note -> assertThat(note.step()).isEqualTo(4));
    }

    // ---- the domain rules still apply on the new transport ------------------

    @Test
    void aHostileOpCannotWriteANoteTheHttpPathWouldHaveRejected() {
        // A new transport must not become a new way past the domain rules.
        // Step's constructor and Track.replacePattern sit BELOW the wire, so
        // they still fire.
        assertThatThrownBy(() -> service.applyNote(songId, trackId,
                new NoteOp(NoteOpType.ADD, trackId, 0, "H9", 0.9, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("pitch");

        assertThatThrownBy(() -> service.applyNote(songId, trackId,
                new NoteOp(NoteOpType.ADD, trackId, 0, "C3", 5.0, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("velocity");

        // A 1-bar beat is 16 steps; a note at 20 does not fit it.
        assertThatThrownBy(() -> service.applyNote(songId, trackId,
                new NoteOp(NoteOpType.ADD, trackId, 20, "C3", 0.9, 1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ---- authorization: the id you check must be the id you act on ---------

    @Test
    void aLaneFromAnotherSongIsRefusedEvenThoughTheCallerMayEditThisOne() {
        UUID foreignTrack = UUID.randomUUID();
        when(trackRepository.findSongIdById(foreignTrack))
                .thenReturn(Optional.of(UUID.randomUUID())); // belongs elsewhere

        // The caller was authorized against songId (@PreAuthorize on the
        // handler) but trackId arrives in the message BODY. Without this check,
        // an editor on any one song could write to every lane in the database
        // by naming a foreign trackId — authorizing one id and acting on
        // another is a classic hole.
        assertThatThrownBy(() -> service.applyNote(songId, foreignTrack, add(foreignTrack, 0, "C3")))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void anUnknownLaneIsNotFound() {
        UUID ghost = UUID.randomUUID();
        when(trackRepository.findSongIdById(ghost)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.applyNote(songId, ghost, add(ghost, 0, "C3")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void theAppliedVersionIsReportedBackForTheBroadcast() {
        // Clients keep this to feed expectedVersion if the socket drops and the
        // editor falls back to the whole-pattern HTTP save.
        NoteApplied applied = service.applyNote(songId, trackId, add(trackId, 0, "C3"));

        assertThat(applied.trackId()).isEqualTo(trackId);
        assertThat(applied.version()).isEqualTo(track.getVersion());
    }

    @Test
    void patternSurvivesAMixOfOpsInOrder() {
        List<NoteOp> ops = List.of(
                add(trackId, 0, "C3"),
                add(trackId, 4, "E3"),
                add(trackId, 8, "G3"),
                remove(trackId, 4, "E3"),
                add(trackId, 12, "C4"));

        ops.forEach(op -> service.applyNote(songId, trackId, op));

        assertThat(track.getPattern())
                .extracting(Step::pitch)
                .containsExactlyInAnyOrder("C3", "G3", "C4");
    }
}
