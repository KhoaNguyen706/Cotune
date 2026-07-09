package com.cotune.common.mapping;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/**
 * Extracted from SongMapper the moment a second mapper needed it — the
 * right time to de-duplicate is when the second consumer appears, not
 * preemptively (you can't design a good abstraction from one example).
 */
public final class Timestamps {

    private Timestamps() {
        // static utility, never instantiated
    }

    /**
     * Entities store Instant (an unambiguous point on the timeline); the
     * API speaks OffsetDateTime because the GraphQL DateTime scalar is
     * RFC-3339, which requires an explicit offset. We standardize on UTC
     * at the boundary — clients localize for display. Null-safe because
     * unsaved entities have null timestamps.
     */
    public static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
