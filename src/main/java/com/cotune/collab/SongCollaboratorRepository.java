package com.cotune.collab;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Note the method names: `id_SongId` walks INTO the composite key
 * (SongCollaborator.id.songId). The underscore is Spring Data's explicit
 * path separator — findByIdSongId would parse too, but only by guessing
 * where the property boundary is, and the guess breaks the moment a field
 * named `idSong` exists. Being explicit costs one character and removes a
 * whole class of "no property found" startup failures.
 */
public interface SongCollaboratorRepository
        extends JpaRepository<SongCollaborator, SongCollaboratorId> {

    /** The access check: is this user on this song, and as what? */
    Optional<SongCollaborator> findById_SongIdAndId_UserId(UUID songId, UUID userId);

    /** The share sheet: everyone on one song, invite order. */
    List<SongCollaborator> findById_SongIdOrderByCreatedAtAsc(UUID songId);

    /**
     * The @BatchMapping feeder: memberships for MANY songs in one query.
     * Resolving Song.collaborators song-by-song would be the N+1 problem
     * the batch mappers elsewhere in this codebase exist to avoid.
     */
    List<SongCollaborator> findById_SongIdInOrderByCreatedAtAsc(Collection<UUID> songIds);

    /**
     * The caller's own memberships across a set of songs — one query to
     * answer Song.myRole for a whole page of songs.
     */
    List<SongCollaborator> findById_UserIdAndId_SongIdIn(UUID userId, Collection<UUID> songIds);

    /** Revoking access. Derived deletes run inside the caller's transaction. */
    void deleteById_SongIdAndId_UserId(UUID songId, UUID userId);
}
