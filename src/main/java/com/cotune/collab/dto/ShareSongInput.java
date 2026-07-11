package com.cotune.collab.dto;

import com.cotune.collab.CollaboratorRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * "Give <email> <role> access to <song>."
 *
 * Invite by EMAIL, not by user id. A user id is an opaque UUID nobody can
 * type, so an id-based API would force the client to search users first —
 * i.e. it would require a user-directory endpoint, which is a much bigger
 * privacy surface than "confirm this one address". Email is the identifier
 * humans already exchange.
 *
 * The actor (who is doing the sharing) is NOT a field here. It comes from
 * the verified token in the controller — the same mass-assignment rule that
 * keeps ownerId out of CreateSongInput and role out of RegisterInput.
 */
public record ShareSongInput(
        @NotNull UUID songId,

        // Bean Validation runs at the GraphQL boundary (@Valid on the
        // resolver), so a malformed address is refused before any database
        // work happens.
        @NotBlank @Email String email,

        @NotNull CollaboratorRole role
) {
}
