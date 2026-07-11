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

    public static ResourceNotFoundException user(UUID id) {
        return new ResourceNotFoundException("User not found: " + id);
    }

    /**
     * Sharing needs to say "nobody here by that name" in a way the inviter
     * can act on ("typo? ask them to sign up?"), so the message names the
     * address. That does make the endpoint an account-existence oracle —
     * accepted knowingly: registration already leaks the same fact (it
     * refuses duplicate emails), so hiding it here would buy nothing while
     * making a legitimate invite unexplainable. If Cotune ever needs to be
     * enumeration-proof, BOTH endpoints have to change together.
     */
    public static ResourceNotFoundException userByEmail(String email) {
        return new ResourceNotFoundException("No Cotune account for " + email);
    }

    public static ResourceNotFoundException collaborator(UUID songId, UUID userId) {
        return new ResourceNotFoundException(
                "User %s is not a collaborator on song %s".formatted(userId, songId));
    }

    public static ResourceNotFoundException beat(UUID id) {
        return new ResourceNotFoundException("Beat not found: " + id);
    }

    public static ResourceNotFoundException audioFile(UUID id) {
        return new ResourceNotFoundException("Audio file not found: " + id);
    }

    public static ResourceNotFoundException clip(UUID id) {
        return new ResourceNotFoundException("Clip not found: " + id);
    }
}
