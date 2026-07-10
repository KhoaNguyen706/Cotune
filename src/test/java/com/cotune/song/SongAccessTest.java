package com.cotune.song;

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
import static org.mockito.Mockito.when;

/**
 * The authorization DECISION tested in isolation — the whole point of
 * putting it in a named bean instead of inlining SpEL: you can enumerate
 * the security cases in fast unit tests, which you cannot do for an
 * expression living inside an annotation string.
 */
@ExtendWith(MockitoExtension.class)
class SongAccessTest {

    @Mock
    private SongRepository songRepository;

    private SongAccess access() {
        return new SongAccess(songRepository);
    }

    private static Authentication authFor(UUID userId, String... roles) {
        return UsernamePasswordAuthenticationToken.authenticated(
                userId.toString(),
                null,
                List.of(roles).stream().map(SimpleGrantedAuthority::new).toList());
    }

    @Test
    void ownerMayDelete() {
        UUID owner = UUID.randomUUID();
        UUID songId = UUID.randomUUID();
        when(songRepository.findById(songId))
                .thenReturn(Optional.of(new Song("Mine", 120, "4/4", owner)));

        assertThat(access().canDelete(songId, authFor(owner, "ROLE_USER"))).isTrue();
    }

    @Test
    void nonOwnerMayNotDeleteEvenAsAdmin() {
        // The requested rule, verbatim: the app admin is NOT the song's
        // admin. Owned songs are deletable by their owner alone.
        UUID songId = UUID.randomUUID();
        when(songRepository.findById(songId))
                .thenReturn(Optional.of(new Song("Not yours", 120, "4/4", UUID.randomUUID())));

        assertThat(access().canDelete(songId, authFor(UUID.randomUUID(), "ROLE_USER"))).isFalse();
        assertThat(access().canDelete(songId, authFor(UUID.randomUUID(), "ROLE_ADMIN"))).isFalse();
    }

    @Test
    void legacyOwnerlessSongIsAdminManaged() {
        UUID songId = UUID.randomUUID();
        // Pre-V5 rows have no owner; the protected no-arg path can't build
        // one, so simulate via a mock-free trick: an entity from the old
        // world is just... absent an owner. We use reflection-free set-up:
        Song legacy = new Song("Old", 120, "4/4", UUID.randomUUID());
        org.springframework.test.util.ReflectionTestUtils.setField(legacy, "ownerId", null);
        when(songRepository.findById(songId)).thenReturn(Optional.of(legacy));

        assertThat(access().canDelete(songId, authFor(UUID.randomUUID(), "ROLE_USER"))).isFalse();
        assertThat(access().canDelete(songId, authFor(UUID.randomUUID(), "ROLE_ADMIN"))).isTrue();
    }

    @Test
    void missingSongIsAllowedThroughSoTheServiceCan404() {
        UUID songId = UUID.randomUUID();
        when(songRepository.findById(songId)).thenReturn(Optional.empty());

        // FORBIDDEN for a nonexistent id would leak which ids exist;
        // letting the call through makes the service answer NOT_FOUND.
        assertThat(access().canDelete(songId, authFor(UUID.randomUUID(), "ROLE_USER"))).isTrue();
    }

    @Test
    void editFollowsTheSameOwnershipRuleAsDelete() {
        UUID owner = UUID.randomUUID();
        UUID songId = UUID.randomUUID();
        when(songRepository.findById(songId))
                .thenReturn(Optional.of(new Song("Mine", 120, "4/4", owner)));

        assertThat(access().canEdit(songId, authFor(owner, "ROLE_USER"))).isTrue();
        assertThat(access().canEdit(songId, authFor(UUID.randomUUID(), "ROLE_USER"))).isFalse();
        assertThat(access().canEdit(songId, authFor(UUID.randomUUID(), "ROLE_ADMIN"))).isFalse();

        when(songRepository.findById(songId)).thenReturn(Optional.empty());
        assertThat(access().canEdit(songId, authFor(UUID.randomUUID(), "ROLE_USER"))).isTrue();
    }
}
