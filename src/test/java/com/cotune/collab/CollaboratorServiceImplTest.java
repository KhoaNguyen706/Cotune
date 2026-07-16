package com.cotune.collab;

import com.cotune.collab.dto.CollaboratorDto;
import com.cotune.collab.dto.ShareSongInput;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongAccessCache;
import com.cotune.song.SongRepository;
import com.cotune.user.User;
import com.cotune.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CollaboratorServiceImplTest {

    @Mock
    private SongCollaboratorRepository collaboratorRepository;
    @Mock
    private SongRepository songRepository;
    @Mock
    private UserRepository userRepository;
    /** Mocked because it is the socket's authorization memo talking to nothing
     *  here — that sharing EVICTS it is behaviour a mock can only assert was
     *  called, so the real proof lives in an integration test with a live
     *  socket (RealtimeStompIntegrationTest#revokingAnEditorStopsTheirVeryNextNote). */
    @Mock
    private SongAccessCache songAccessCache;

    private CollaboratorServiceImpl service;

    private final UUID songId = UUID.randomUUID();
    private final UUID ownerId = UUID.randomUUID();
    private final UUID inviteeId = UUID.randomUUID();
    private Song song;
    private User invitee;

    @BeforeEach
    void setUp() {
        // The mapper is a pure function — mocking it would only let a broken
        // mapping pass. Use the real one; mock only what talks to a database.
        service = new CollaboratorServiceImpl(
                collaboratorRepository, songRepository, userRepository, new CollaboratorMapper(),
                songAccessCache);

        song = new Song("Shared Sketch", 120, "4/4", ownerId);
        ReflectionTestUtils.setField(song, "id", songId);

        invitee = new User("bob@example.com", "hash", "Bob");
        ReflectionTestUtils.setField(invitee, "id", inviteeId);
    }

    private ShareSongInput share(String email, CollaboratorRole role) {
        return new ShareSongInput(songId, email, role);
    }

    @Test
    void invitesByEmailRegardlessOfHowItWasTyped() {
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        when(userRepository.findByEmail("bob@example.com")).thenReturn(Optional.of(invitee));
        when(collaboratorRepository.findById_SongIdAndId_UserId(songId, inviteeId))
                .thenReturn(Optional.empty());
        when(collaboratorRepository.save(any(SongCollaborator.class)))
                .thenAnswer(call -> call.getArgument(0));

        // Typed with capitals and stray whitespace, as a human would. If the
        // service didn't normalize through User.normalizeEmail — the SAME
        // function registration uses — this lookup would miss and the invite
        // would fail with a baffling "no such account".
        CollaboratorDto result = service.share(share("  BOB@Example.COM ", CollaboratorRole.EDITOR), ownerId);

        assertThat(result.userId()).isEqualTo(inviteeId);
        assertThat(result.email()).isEqualTo("bob@example.com");
        assertThat(result.displayName()).isEqualTo("Bob"); // the row stores a UUID; the DTO carries a person
        assertThat(result.role()).isEqualTo(CollaboratorRole.EDITOR);
    }

    @Test
    void resharingChangesTheRoleInsteadOfInsertingASecondRow() {
        SongCollaborator existing =
                new SongCollaborator(songId, inviteeId, CollaboratorRole.VIEWER, ownerId);
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        when(userRepository.findByEmail("bob@example.com")).thenReturn(Optional.of(invitee));
        when(collaboratorRepository.findById_SongIdAndId_UserId(songId, inviteeId))
                .thenReturn(Optional.of(existing));

        CollaboratorDto result = service.share(share("bob@example.com", CollaboratorRole.EDITOR), ownerId);

        // Promoted in place: same row, new role. The composite PK would reject
        // a second insert anyway (V10) — this makes the API idempotent instead
        // of making it a unique-violation 500.
        assertThat(result.role()).isEqualTo(CollaboratorRole.EDITOR);
        assertThat(existing.getRole()).isEqualTo(CollaboratorRole.EDITOR);
        verify(collaboratorRepository, never()).save(any());
    }

    @Test
    void cannotShareASongWithItsOwner() {
        User owner = new User("alice@example.com", "hash", "Alice");
        ReflectionTestUtils.setField(owner, "id", ownerId);
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(owner));

        // The owner already holds every right this table can grant. A
        // membership row for them would be a second, weaker source of truth
        // about their access — and unshare() would then look able to evict
        // the owner from their own song.
        assertThatThrownBy(() -> service.share(share("alice@example.com", CollaboratorRole.EDITOR), ownerId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("already own");
    }

    @Test
    void invitingAnAddressWithNoAccountIsNotFound() {
        when(songRepository.findById(songId)).thenReturn(Optional.of(song));
        when(userRepository.findByEmail("ghost@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.share(share("ghost@example.com", CollaboratorRole.VIEWER), ownerId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("ghost@example.com");
    }

    @Test
    void revokingSomeoneWhoWasNeverInvitedIsNotFound() {
        when(collaboratorRepository.findById_SongIdAndId_UserId(songId, inviteeId))
                .thenReturn(Optional.empty());

        // A derived delete is silent about rows that were never there, so
        // without the explicit check this would report cheerful success for a
        // typo'd id — and the owner would believe they had revoked someone.
        assertThatThrownBy(() -> service.unshare(songId, inviteeId))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(collaboratorRepository, never()).deleteById_SongIdAndId_UserId(any(), any());
    }

    @Test
    void listForSongsGroupsBySongAndJoinsUsersInOneQuery() {
        UUID otherSongId = UUID.randomUUID();
        List<UUID> songIds = List.of(songId, otherSongId);
        when(collaboratorRepository.findById_SongIdInOrderByCreatedAtAsc(songIds)).thenReturn(List.of(
                new SongCollaborator(songId, inviteeId, CollaboratorRole.EDITOR, ownerId),
                new SongCollaborator(otherSongId, inviteeId, CollaboratorRole.VIEWER, ownerId)));
        when(userRepository.findAllById(List.of(inviteeId, inviteeId)))
                .thenReturn(List.of(invitee));

        var bySong = service.listForSongs(songIds);

        assertThat(bySong.get(songId)).singleElement()
                .extracting(CollaboratorDto::role).isEqualTo(CollaboratorRole.EDITOR);
        assertThat(bySong.get(otherSongId)).singleElement()
                .extracting(CollaboratorDto::role).isEqualTo(CollaboratorRole.VIEWER);

        // ONE user query for the whole page, not one per membership row —
        // the N+1 this method exists to avoid.
        verify(userRepository).findAllById(any(Iterable.class));
    }

    @Test
    void noSongsMeansNoQuery() {
        // An empty IN () is invalid SQL in several dialects, and issuing a
        // query to ask about nothing is a waste regardless.
        assertThat(service.listForSongs(List.of())).isEmpty();
        verify(collaboratorRepository, never()).findById_SongIdInOrderByCreatedAtAsc(any());
    }
}
