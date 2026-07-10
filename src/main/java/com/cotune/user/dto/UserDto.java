package com.cotune.user.dto;

import com.cotune.user.Role;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * The API's view of an account. Note what is ABSENT: passwordHash.
 * The DTO boundary is exactly where that kind of leak is prevented —
 * if we serialized the entity directly, forgetting one @JsonIgnore
 * would ship password hashes to every client.
 */
public record UserDto(
        UUID id,
        String email,
        String displayName,
        Role role,
        OffsetDateTime createdAt
) {
}
