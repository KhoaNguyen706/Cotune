package com.cotune.song;

import com.cotune.collab.CollaboratorRole;
import com.cotune.collab.SongCollaborator;
import com.cotune.collab.SongCollaboratorRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * The authorization DECISION tested in isolation — the whole point of putting
 * it in a named bean instead of inlining SpEL: you can enumerate the security
 * cases in fast unit tests, which you cannot do for an expression living
 * inside an annotation string.
 *
 * Since V10 the interesting thing to enumerate is the permission MATRIX
 * (view/edit/share/delete × owner/editor/viewer/stranger). The tests below
 * are organized to mirror it row by row, because the bugs this class exists
 * to prevent are all "one cell is wrong" bugs — and a cell nobody asserts is
 * a cell nobody notices.
 */
@ExtendWith(MockitoExtension.class)
class SongAccessTest {

    @Mock
    private SongRepository songRepository;

    @Mock
    private SongCollaboratorRepository collaboratorRepository;

    private final UUID songId = UUID.randomUUID();
    private final UUID owner = UUID.randomUUID();
    private final UUID guest = UUID.randomUUID();

    private SongAccess access() {
        return new SongAccess(songRepository, collaboratorRepository);
    }

    private static Authentication authFor(UUID userId, String... roles) {
        return UsernamePasswordAuthenticationToken.authenticated(
                userId.toString(),
                null,
                List.of(roles).stream().map(SimpleGrantedAuthority::new).toList());
    }

    /** An owned song exists at songId. */
    private void songExists() {
        when(songRepository.findById(songId))
                .thenReturn(Optional.of(new Song("Mine", 120, "4/4", owner)));
    }

    /** ...and `guest` is on it in the given role (or in none, if null). */
    private void guestIs(CollaboratorRole role) {
        // lenient(): the owner-side assertions short-circuit before this stub
        // is ever consulted, and a strict stub would fail the test for being
        // "unnecessary" — which is exactly the behaviour we're relying on.
        lenient().when(collaboratorRepository.findById_SongIdAndId_UserId(songId, guest))
                .thenReturn(role == null
                        ? Optional.empty()
                        : Optional.of(new SongCollaborator(songId, guest, role, owner)));
    }

    // ---- OWNER: everything -------------------------------------------------

    @Test
    void ownerMayDoEverything() {
        songExists();
        Authentication auth = authFor(owner, "ROLE_USER");

        assertThat(access().canView(songId, auth)).isTrue();
        assertThat(access().canEdit(songId, auth)).isTrue();
        assertThat(access().canShare(songId, auth)).isTrue();
        assertThat(access().canDelete(songId, auth)).isTrue();
    }

    // ---- EDITOR: may change the music, may not change the guest list -------

    @Test
    void editorMayViewAndEditButNotShareOrDelete() {
        songExists();
        guestIs(CollaboratorRole.EDITOR);
        Authentication auth = authFor(guest, "ROLE_USER");

        assertThat(access().canView(songId, auth)).isTrue();
        assertThat(access().canEdit(songId, auth)).isTrue();

        // THE test of this session. An editor who could share would be able to
        // invite further editors — access escalating away from the owner with
        // nothing to stop it. An editor who could delete could destroy work
        // that isn't theirs. If someone "simplifies" canShare to canEdit one
        // day, this is the assertion that has to go red.
        assertThat(access().canShare(songId, auth)).isFalse();
        assertThat(access().canDelete(songId, auth)).isFalse();
    }

    // ---- VIEWER: read, and nothing else ------------------------------------

    @Test
    void viewerMayOnlyView() {
        songExists();
        guestIs(CollaboratorRole.VIEWER);
        Authentication auth = authFor(guest, "ROLE_USER");

        assertThat(access().canView(songId, auth)).isTrue();
        assertThat(access().canEdit(songId, auth)).isFalse();
        assertThat(access().canShare(songId, auth)).isFalse();
        assertThat(access().canDelete(songId, auth)).isFalse();
    }

    // ---- STRANGER: nothing, not even a look --------------------------------

    @Test
    void strangerMayNotEvenView() {
        songExists();
        guestIs(null); // never invited
        Authentication auth = authFor(guest, "ROLE_USER");

        // Reads used to be open to any authenticated user; a song you were
        // never invited to is now invisible to you by id, too.
        assertThat(access().canView(songId, auth)).isFalse();
        assertThat(access().canEdit(songId, auth)).isFalse();
    }

    @Test
    void beingAnAppAdminDoesNotMakeYouTheSongsAdmin() {
        songExists();
        guestIs(null);

        // hasRole('ADMIN') says what KIND of user you are, not what you own.
        assertThat(access().canDelete(songId, authFor(guest, "ROLE_ADMIN"))).isFalse();
        assertThat(access().canEdit(songId, authFor(guest, "ROLE_ADMIN"))).isFalse();
    }

    // ---- edge cases the whole design leans on ------------------------------

    @Test
    void legacyOwnerlessSongIsAdminManaged() {
        // Pre-V5 rows have no owner. The constructor refuses to build one, so
        // reach past it — this state exists in the database, not in the domain.
        Song legacy = new Song("Old", 120, "4/4", UUID.randomUUID());
        ReflectionTestUtils.setField(legacy, "ownerId", null);
        when(songRepository.findById(songId)).thenReturn(Optional.of(legacy));

        assertThat(access().canDelete(songId, authFor(guest, "ROLE_USER"))).isFalse();
        assertThat(access().canView(songId, authFor(guest, "ROLE_USER"))).isFalse();
        assertThat(access().canDelete(songId, authFor(guest, "ROLE_ADMIN"))).isTrue();
        assertThat(access().canView(songId, authFor(guest, "ROLE_ADMIN"))).isTrue();
    }

    @Test
    void missingSongIsAllowedThroughSoTheServiceCan404() {
        when(songRepository.findById(any())).thenReturn(Optional.empty());
        Authentication auth = authFor(guest, "ROLE_USER");

        // FORBIDDEN for a nonexistent id would leak which ids exist (403 =
        // real, 404 = not). Letting the call through makes the SERVICE answer
        // NOT_FOUND, so both cases look identical from outside.
        assertThat(access().canView(songId, auth)).isTrue();
        assertThat(access().canEdit(songId, auth)).isTrue();
        assertThat(access().canShare(songId, auth)).isTrue();
        assertThat(access().canDelete(songId, auth)).isTrue();
    }

    // ---- the batch path behind Song.myRole ---------------------------------

    @Test
    void rolesForReportsOwnerEditorAndSilenceForStrangers() {
        UUID ownedSong = UUID.randomUUID();
        UUID sharedSong = UUID.randomUUID();
        UUID strangersSong = UUID.randomUUID();
        List<UUID> ids = List.of(ownedSong, sharedSong, strangersSong);

        Song owned = new Song("Mine", 120, "4/4", guest);
        ReflectionTestUtils.setField(owned, "id", ownedSong);
        Song shared = new Song("Theirs", 120, "4/4", owner);
        ReflectionTestUtils.setField(shared, "id", sharedSong);
        Song strangers = new Song("Nobody's business", 120, "4/4", owner);
        ReflectionTestUtils.setField(strangers, "id", strangersSong);

        when(songRepository.findAllById(ids)).thenReturn(List.of(owned, shared, strangers));
        when(collaboratorRepository.findById_UserIdAndId_SongIdIn(guest, ids)).thenReturn(
                List.of(new SongCollaborator(sharedSong, guest, CollaboratorRole.EDITOR, owner)));

        var roles = access().rolesFor(guest, ids);

        assertThat(roles).containsEntry(ownedSong, SongRole.OWNER);
        assertThat(roles).containsEntry(sharedSong, SongRole.EDITOR);
        // Absent, not "NONE": the answer for a stranger's song is nothing,
        // and the map says so by having nothing to say.
        assertThat(roles).doesNotContainKey(strangersSong);
    }
}
