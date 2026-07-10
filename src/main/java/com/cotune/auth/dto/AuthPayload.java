package com.cotune.auth.dto;

import com.cotune.user.dto.UserDto;

import java.time.OffsetDateTime;

/**
 * What register/login return: the token plus the user it represents.
 * Bundling the user saves the client an immediate follow-up `me` query;
 * expiresAt lets it schedule re-login (or, later, a refresh) proactively
 * instead of discovering expiry via a failed request.
 */
public record AuthPayload(
        String token,
        OffsetDateTime expiresAt,
        UserDto user
) {
}
