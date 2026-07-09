package com.cotune.common.exception;

import java.util.UUID;

/**
 * Unchecked on purpose: "row not found" is not something callers can
 * meaningfully recover from mid-flow, so we don't force try/catch up the
 * stack. It propagates to one central handler (GraphqlExceptionResolver)
 * that translates it into an API-level NOT_FOUND error.
 */
public class ResourceNotFoundException extends RuntimeException {

    private ResourceNotFoundException(String message) {
        super(message);
    }

    // Static factory per resource type keeps the message format consistent
    // and gives call sites a readable one-liner.
    public static ResourceNotFoundException song(UUID id) {
        return new ResourceNotFoundException("Song not found: " + id);
    }

    public static ResourceNotFoundException track(UUID id) {
        return new ResourceNotFoundException("Track not found: " + id);
    }
}
