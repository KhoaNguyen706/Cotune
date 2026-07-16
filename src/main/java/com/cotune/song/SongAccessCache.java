package com.cotune.song;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A MEMO in front of SongAccess, for the WebSocket's hot path only.
 *
 * THE BUG THIS EXISTS FOR — reported as "it's not actually real-time, it takes
 * a while for my friend to see my edit", and it was not the socket's fault:
 *
 *   @PreAuthorize("@songAccess.canView(...)") ran on EVERY inbound frame, and
 *   canView is a database read (one SELECT for an owner, two for a
 *   collaborator). The editor sends a cursor frame every 50ms while the mouse
 *   is moving (CURSOR_THROTTLE_MS), so ONE person waggling a mouse was ~20-40
 *   queries per second, and two people were ~60 — every one of them a round
 *   trip to a Postgres that lives in another datacentre, and every one of them
 *   holding a connection out of a production pool of FIVE.
 *
 *   Cursor frames therefore starved the thing that actually matters. A note op
 *   arrived, waited for a connection behind a queue of mouse movements, and
 *   landed on the other screen seconds later. The transport was never slow;
 *   the authorization was, 20 times a second, for a message that persists
 *   nothing.
 *
 * WHY A MEMO AND NOT A REWRITE: on a miss this DELEGATES to SongAccess. The
 * rules live in exactly one place, still, and the cached answer cannot drift
 * from the uncached one because it IS the uncached one. Re-deriving "is this
 * person an editor" here would be a second implementation of the authorization
 * model — the single worst thing to have two of.
 *
 * WHAT IT COSTS, stated plainly: an answer can be up to {@link #TTL} stale.
 * Revoke someone's access while their mouse is moving and they may keep
 * editing for that long over the socket. Three things bound it:
 *
 *   1. Sharing changes EVICT (see CollaboratorServiceImpl), so the common case
 *      is not stale at all — the TTL is a backstop, not the mechanism.
 *   2. Eviction is per-JVM. With more than one instance (REALTIME_RELAY=redis)
 *      the other instances only learn on expiry, which is what keeps the TTL
 *      short rather than generous.
 *   3. HTTP and GraphQL do NOT come through here. Every REST/GraphQL mutation
 *      still asks SongAccess directly, so the authoritative path — including
 *      every way to change a song's *structure* — is exactly as strict as it
 *      was.
 *
 * The entry being cached is a BOOLEAN per right, not a role: it is the answer
 * to the precise question that was asked, so there is no logic here to get
 * wrong. PresenceQueryCostTest pins the whole point (zero queries per frame).
 */
@Component("songAccessCache")
@RequiredArgsConstructor
public class SongAccessCache {

    /**
     * Short ON PURPOSE. The win does not need a long TTL: at 20 frames/sec,
     * even this turns ~20 queries/second into one per ten seconds — a ~200x
     * cut — so there is no reason to buy staleness we don't need. Long enough
     * to cover a drag; short enough that a revocation on another instance is
     * a blink, not a session.
     */
    private static final Duration TTL = Duration.ofSeconds(10);

    private final SongAccess songAccess;

    private final Map<Key, Entry> entries = new ConcurrentHashMap<>();

    /** Which question was asked. Caching the RIGHT, not a role, keeps this
     *  class free of any opinion about what a role implies. */
    private enum Right { VIEW, EDIT }

    private record Key(UUID songId, String userId, Right right) {}

    private record Entry(boolean allowed, long expiresAtMillis) {
        boolean live(long now) {
            return now < expiresAtMillis;
        }
    }

    /** @see SongAccess#canView — same answer, memoized. */
    public boolean canView(UUID songId, Authentication authentication) {
        return decide(songId, authentication, Right.VIEW);
    }

    /** @see SongAccess#canEdit — same answer, memoized. */
    public boolean canEdit(UUID songId, Authentication authentication) {
        return decide(songId, authentication, Right.EDIT);
    }

    /**
     * Forget everything we think we know about this song.
     *
     * Called when the collaborator list changes: that is the ONE event that can
     * turn a cached `true` into a lie, and it is rare, so paying a full re-check
     * for it is free. Evicting the whole song rather than the one user keeps the
     * caller from having to know whose entry to drop.
     */
    public void evictSong(UUID songId) {
        entries.keySet().removeIf(key -> key.songId().equals(songId));
    }

    private boolean decide(UUID songId, Authentication authentication, Right right) {
        // The token's subject. Anonymous sessions can't reach a @MessageMapping
        // (the socket refuses CONNECT without a valid JWT), but keying on
        // getName() means even if one did, it gets its own entry rather than
        // sharing anybody's.
        Key key = new Key(songId, authentication.getName(), right);
        long now = System.currentTimeMillis();

        Entry cached = entries.get(key);
        if (cached != null && cached.live(now)) {
            return cached.allowed();
        }

        // MISS: ask the authority. Note this is deliberately not computeIfAbsent
        // — that holds a lock on the map bin while the mapping function runs,
        // and this mapping function does database I/O. Two frames racing here
        // simply both ask and both write the same answer, which costs one extra
        // query and blocks nobody.
        boolean allowed = switch (right) {
            case VIEW -> songAccess.canView(songId, authentication);
            case EDIT -> songAccess.canEdit(songId, authentication);
        };
        entries.put(key, new Entry(allowed, now + TTL.toMillis()));

        // Opportunistic sweep of dead entries. The map is keyed by (song, user,
        // right) so it is bounded by real people in real songs, but a long-lived
        // instance would otherwise accumulate an entry for every session that
        // ever connected. Doing it on a miss (rare, by construction) keeps it
        // off the hot path and needs no scheduler.
        if (entries.size() > SWEEP_THRESHOLD) {
            entries.values().removeIf(entry -> !entry.live(now));
        }
        return allowed;
    }

    /** Big enough that a normal room never sweeps; small enough that a busy
     *  instance can't grow the map without bound. */
    private static final int SWEEP_THRESHOLD = 1024;
}
