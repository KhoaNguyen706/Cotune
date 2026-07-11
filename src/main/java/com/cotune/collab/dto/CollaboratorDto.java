package com.cotune.collab.dto;

import com.cotune.collab.CollaboratorRole;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One person on a song, as the share sheet needs them.
 *
 * The membership ROW only stores a user id — but a UI that renders
 * "b7f1…-c3a2" instead of "Bob (bob@example.com)" is useless, so the
 * service joins the identity in here. This is why the DTO is not just a
 * mirror of the entity: DTOs are shaped by the SCREEN, entities by the
 * TABLE, and those two pressures genuinely differ.
 *
 * Deliberately absent: the password hash, the role on the platform (USER /
 * ADMIN), timestamps of the account. Sharing a song exposes exactly enough
 * of a person to identify them and no more.
 */
public record CollaboratorDto(
        UUID userId,
        String email,
        String displayName,
        CollaboratorRole role,
        OffsetDateTime createdAt
) {
}
