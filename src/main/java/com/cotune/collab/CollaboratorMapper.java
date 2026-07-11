package com.cotune.collab;

import com.cotune.collab.dto.CollaboratorDto;
import com.cotune.common.mapping.Timestamps;
import com.cotune.user.User;
import org.springframework.stereotype.Component;

/**
 * Entity + identity → DTO. It takes TWO inputs because the membership row
 * and the person it refers to live in different tables (and different
 * feature packages); the join happens in the service, which owns the
 * transaction, and the mapper stays a pure function of what it is handed.
 *
 * Keeping the lookup OUT of the mapper is what lets the service fetch all
 * the users for a page of songs in one findAllById and then map in a loop —
 * a mapper that fetched its own User would be an N+1 generator that no
 * caller could opt out of.
 */
@Component
public class CollaboratorMapper {

    public CollaboratorDto toDto(SongCollaborator collaborator, User user) {
        return new CollaboratorDto(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                collaborator.getRole(),
                Timestamps.utc(collaborator.getCreatedAt())
        );
    }
}
