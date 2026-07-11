package com.cotune.collab;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AccessLevel;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.UUID;

/**
 * The composite primary key of song_collaborators: (song_id, user_id).
 *
 * Every other table in this schema has a surrogate UUID id. This one does
 * not, on purpose — the row IS the pair. A surrogate key here would need a
 * separate UNIQUE(song_id, user_id) constraint to say the same thing, i.e.
 * the same invariant expressed twice, with a redundant column to maintain.
 *
 * TWO JPA CONTRACTS ARE NON-NEGOTIABLE HERE, and both are easy to miss:
 *
 *   1. Serializable. The JPA spec requires it of every id class; Hibernate
 *      serializes keys when it caches them.
 *   2. Real value-based equals/hashCode. Hibernate looks entities up BY KEY
 *      in the persistence context's hash map, so two SongCollaboratorId
 *      objects holding the same UUIDs must be equal and hash alike. With
 *      the default identity equality, every findById would miss the cache
 *      and, worse, merge() would insert duplicates.
 *
 * Note the inversion from Song/User: there, @EqualsAndHashCode is BANNED
 * (field-based equality breaks entity identity semantics as fields mutate).
 * Here it is REQUIRED — because an id class is a value object whose fields
 * are immutable by definition. Same annotation, opposite verdict; the
 * difference is entity vs. value, not style.
 */
@Embeddable
@Getter
@EqualsAndHashCode
@NoArgsConstructor(access = AccessLevel.PROTECTED) // JPA reflection only
public class SongCollaboratorId implements Serializable {

    @Column(name = "song_id", nullable = false)
    private UUID songId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    public SongCollaboratorId(UUID songId, UUID userId) {
        if (songId == null || userId == null) {
            throw new IllegalArgumentException("A collaborator key needs both a song and a user");
        }
        this.songId = songId;
        this.userId = userId;
    }
}
