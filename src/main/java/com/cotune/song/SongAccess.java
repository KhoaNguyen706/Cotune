package com.cotune.song;

import com.cotune.collab.SongCollaborator;
import com.cotune.collab.SongCollaboratorRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Object-level authorization: "may THIS user do THIS to THIS song?"
 *
 * Roles can't answer that — hasRole('ADMIN') knows what KIND of user you
 * are, not what you own. The Spring idiom for object-level rules is a named
 * bean invoked from SpEL: @PreAuthorize("@songAccess.canEdit(#id,
 * authentication)"). The rule stays declarative on the controller, while the
 * decision (which needs database reads) lives in a testable class.
 *
 * These beans answer QUESTIONS (booleans); they never throw. Spring Security
 * turns `false` into AccessDeniedException → FORBIDDEN for us — decision and
 * enforcement stay separated.
 *
 * SINCE V10 there are three tiers of right, not one, and they are deliberately
 * NOT a straight line:
 *
 *              view   edit   share   delete
 *   OWNER       ✓      ✓       ✓       ✓
 *   EDITOR      ✓      ✓       ✗       ✗
 *   VIEWER      ✓      ✗       ✗       ✗
 *
 * Note where EDITOR stops. An editor who could share would be able to invite
 * further editors, and access to the song would escalate away from the owner
 * with no way to see it coming — the classic transitive-delegation hole. An
 * editor who could delete could destroy work they don't own. Both rights stay
 * with the person who created the song; "can change the music" and "can change
 * who gets in" are different powers and the schema treats them that way.
 *
 * Every child feature (BeatAccess, TrackAccess, ClipAccess, AudioAccess)
 * resolves its resource UP to the owning song and delegates here, so this
 * table is the whole authorization model of the application — there is no
 * second copy of it anywhere, including the frontend, which is told its
 * effective role (Song.myRole) rather than deriving one.
 */
@Component("songAccess")
@RequiredArgsConstructor
public class SongAccess {

    private final SongRepository songRepository;
    private final SongCollaboratorRepository collaboratorRepository;

    /** May they open it at all? Owner, or invited in any role. */
    @Transactional(readOnly = true)
    public boolean canView(UUID songId, Authentication authentication) {
        return check(songId, authentication, role -> true);
    }

    /**
     * May they change the music — beats, lanes, patterns, clips, audio?
     * Owner or EDITOR. This is the rule every child resource delegates to.
     */
    @Transactional(readOnly = true)
    public boolean canEdit(UUID songId, Authentication authentication) {
        return check(songId, authentication, role -> role == SongRole.OWNER || role == SongRole.EDITOR);
    }

    /** May they invite or evict collaborators? Owner only — see the table above. */
    @Transactional(readOnly = true)
    public boolean canShare(UUID songId, Authentication authentication) {
        return check(songId, authentication, role -> role == SongRole.OWNER);
    }

    /** May they destroy it? Owner only. */
    @Transactional(readOnly = true)
    public boolean canDelete(UUID songId, Authentication authentication) {
        return check(songId, authentication, role -> role == SongRole.OWNER);
    }

    /**
     * The caller's effective role on each song, for Song.myRole. Two queries
     * for an entire page of songs, no matter how long — the per-song version
     * would be an N+1 on the home screen.
     *
     * Songs the caller has no relationship with are ABSENT from the result
     * rather than mapped to some "NONE" value: this method reports what you
     * are, and the answer for a stranger's song is "nothing", which the type
     * system already has a word for.
     */
    @Transactional(readOnly = true)
    public Map<UUID, SongRole> rolesFor(UUID userId, Collection<UUID> songIds) {
        if (songIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, SongRole> roles = new HashMap<>();

        for (Song song : songRepository.findAllById(songIds)) {
            if (userId.equals(song.getOwnerId())) {
                roles.put(song.getId(), SongRole.OWNER);
            }
        }
        for (SongCollaborator membership :
                collaboratorRepository.findById_UserIdAndId_SongIdIn(userId, songIds)) {
            // putIfAbsent, so OWNER always wins over a membership row. The
            // service refuses to create such a row for the owner, but an
            // authorization check must not depend on another class's
            // good behaviour to reach the right answer.
            roles.putIfAbsent(membership.getSongId(), toSongRole(membership));
        }
        return roles;
    }

    /**
     * The single evaluation path every public check above funnels through, so
     * "what role is this caller" is decided in exactly one place and the four
     * rights differ only in the predicate they apply to the answer.
     */
    private boolean check(UUID songId, Authentication authentication, RolePredicate allowed) {
        Optional<Song> song = songRepository.findById(songId);
        if (song.isEmpty()) {
            // Missing song: return TRUE and let the SERVICE throw its
            // NOT_FOUND. Returning false here would answer FORBIDDEN for ids
            // that don't exist — subtly wrong, and it tells an attacker which
            // ids are real (403 = exists, 404 = doesn't).
            return true;
        }
        UUID owner = song.get().getOwnerId();
        if (owner == null) {
            // Legacy rows from before ownership existed (V5): nobody can be
            // their owner, so only an app ADMIN may touch them — including to
            // read them. Every song created since V5 has a real owner.
            return isAdmin(authentication);
        }
        UUID caller = callerId(authentication);
        if (caller == null) {
            return false;
        }
        if (caller.equals(owner)) {
            return allowed.test(SongRole.OWNER);
        }
        return collaboratorRepository.findById_SongIdAndId_UserId(songId, caller)
                .map(membership -> allowed.test(toSongRole(membership)))
                .orElse(false); // no relationship to this song at all
    }

    private static SongRole toSongRole(SongCollaborator membership) {
        // Two enums, one translation point. CollaboratorRole is what can be
        // GRANTED; SongRole is what you effectively ARE (and includes OWNER,
        // which cannot be granted). See SongRole for why they stay separate.
        return switch (membership.getRole()) {
            case EDITOR -> SongRole.EDITOR;
            case VIEWER -> SongRole.VIEWER;
        };
    }

    private static boolean isAdmin(Authentication authentication) {
        return authentication.getAuthorities().stream()
                .anyMatch(granted -> granted.getAuthority().equals("ROLE_ADMIN"));
    }

    /** getName() = the JWT's `sub` claim = the user id (set in JwtService). */
    private static UUID callerId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException notAUuid) {
            // Anonymous ("anonymousUser") or a token from an older format.
            // Not an error — just nobody we can match against an owner.
            return null;
        }
    }

    /** Local functional interface: names the thing (a rule about a role)
     *  instead of leaving a bare Predicate<SongRole> at every call site. */
    @FunctionalInterface
    private interface RolePredicate {
        boolean test(SongRole role);
    }
}
