package com.cotune.song;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Object-level authorization: "may THIS user delete THIS song?"
 *
 * Roles can't answer that — hasRole('ADMIN') knows what KIND of user you
 * are, not what you own. The Spring idiom for object-level rules is a named
 * bean invoked from SpEL: @PreAuthorize("@songAccess.canDelete(#id,
 * authentication)"). The rule stays declarative on the controller, while
 * the decision (which needs a database read) lives in a testable class.
 *
 * Note this bean answers a QUESTION (boolean); it never throws. Spring
 * Security turns `false` into AccessDeniedException → FORBIDDEN for us —
 * decision and enforcement stay separated.
 */
@Component("songAccess")
@RequiredArgsConstructor
public class SongAccess {

    private final SongRepository songRepository;

    @Transactional(readOnly = true)
    public boolean canDelete(UUID songId, Authentication authentication) {
        return songRepository.findById(songId)
                .map(song -> allowedFor(song, authentication))
                // Missing song: return true and let the SERVICE throw its
                // NOT_FOUND. Returning false here would answer FORBIDDEN
                // for ids that don't exist — subtly wrong, and it tells an
                // attacker which ids are real (403 = exists, 404 = doesn't).
                .orElse(true);
    }

    /**
     * May this user MUTATE this song or anything inside it (beats, lanes,
     * patterns, clips, audio)? Same rule as delete: the owner; legacy
     * ownerless rows are admin-only. Reads stay open to any authenticated
     * user — collaborators must see each other's songs before the
     * collaboration phase makes them co-editors.
     *
     * Child features check their own resources by resolving UP to the
     * owning song and delegating here (BeatAccess, TrackAccess, ...): the
     * ownership rule lives in exactly one place.
     */
    @Transactional(readOnly = true)
    public boolean canEdit(UUID songId, Authentication authentication) {
        return songRepository.findById(songId)
                .map(song -> allowedFor(song, authentication))
                .orElse(true); // missing → let the service answer NOT_FOUND
    }

    private boolean allowedFor(Song song, Authentication authentication) {
        UUID owner = song.getOwnerId();
        if (owner == null) {
            // Legacy rows from before ownership existed: only an app ADMIN
            // may clean them up. Every song created since V5 has an owner.
            return authentication.getAuthorities().stream()
                    .anyMatch(granted -> granted.getAuthority().equals("ROLE_ADMIN"));
        }
        // getName() = the JWT's sub claim = user id (set in JwtService).
        return owner.toString().equals(authentication.getName());
    }
}
