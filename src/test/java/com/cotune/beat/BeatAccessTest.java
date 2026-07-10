package com.cotune.beat;

import com.cotune.song.SongAccess;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The child access beans have exactly two behaviors worth pinning down:
 * they RESOLVE (child id → owning song id, then delegate to SongAccess)
 * and they FAIL OPEN on missing children (so services answer NOT_FOUND).
 * One test class covers the pattern; TrackAccess/ClipAccess/AudioAccess
 * are structurally identical and get their coverage from the integration
 * suite's 403 cases.
 */
@ExtendWith(MockitoExtension.class)
class BeatAccessTest {

    @Mock
    private BeatRepository beatRepository;

    @Mock
    private SongAccess songAccess;

    private static Authentication anyUser() {
        return UsernamePasswordAuthenticationToken.authenticated(
                UUID.randomUUID().toString(), null,
                List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }

    @Test
    void resolvesToOwningSongAndDelegates() {
        UUID beatId = UUID.randomUUID();
        UUID songId = UUID.randomUUID();
        Authentication auth = anyUser();
        when(beatRepository.findSongIdById(beatId)).thenReturn(Optional.of(songId));
        when(songAccess.canEdit(songId, auth)).thenReturn(false);

        assertThat(new BeatAccess(beatRepository, songAccess).canEdit(beatId, auth)).isFalse();
        verify(songAccess).canEdit(songId, auth);
    }

    @Test
    void missingBeatFailsOpenSoTheServiceCan404() {
        UUID beatId = UUID.randomUUID();
        when(beatRepository.findSongIdById(beatId)).thenReturn(Optional.empty());

        assertThat(new BeatAccess(beatRepository, songAccess).canEdit(beatId, anyUser())).isTrue();
        verify(songAccess, never()).canEdit(any(), any());
    }
}
