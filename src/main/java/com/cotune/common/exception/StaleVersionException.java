package com.cotune.common.exception;

/**
 * Optimistic-concurrency conflict: the client edited on top of version N
 * but the row is already at version M. Thrown when a mutation carries
 * expectedVersion and it doesn't match — the client must reload and
 * re-apply. Maps to HTTP 409 (REST) / CONFLICT classification (GraphQL).
 *
 * This is the load-bearing half of the @Version columns: without a check
 * on the way IN, two editors silently last-write-win. With it, the same
 * mechanism later powers server-authoritative op ordering for real-time
 * collaboration.
 */
public class StaleVersionException extends RuntimeException {

    public StaleVersionException(String resource, long expected, long actual) {
        super("%s changed since you loaded it (expected version %d, is %d) — reload and retry"
                .formatted(resource, expected, actual));
    }

    /**
     * The one guard every service uses: null expectedVersion = client
     * didn't opt in (a blind write, allowed for backward compatibility);
     * present and stale = conflict.
     */
    public static void check(String resource, Long expected, long actual) {
        if (expected != null && expected != actual) {
            throw new StaleVersionException(resource, expected, actual);
        }
    }
}
