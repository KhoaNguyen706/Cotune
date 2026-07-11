package com.cotune.collab;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * "User U may act on song S as ROLE." One membership row.
 *
 * Like Song and User this is a rich entity: the role changes through
 * changeRole(), not a setter, so an invalid role can never be written and
 * the change has a name you can grep for.
 *
 * The entity holds plain UUIDs rather than @ManyToOne(Song)/@ManyToOne(User)
 * associations — the same call made in Song.ownerId, for the same reason:
 * authorization needs IDENTITIES, not object graphs. Mapping the relations
 * would make every access check drag a Song and a User into memory, and
 * would couple three feature packages together at compile time. The foreign
 * keys still exist where integrity belongs: in the database (V10).
 */
@Entity
@Table(name = "song_collaborators")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SongCollaborator {

    @EmbeddedId
    private SongCollaboratorId id;

    @Enumerated(EnumType.STRING) // never ORDINAL — see User.role for the horror story
    @Column(nullable = false, length = 20)
    private CollaboratorRole role;

    /** Who invited them. Audit trail, and nullable: the inviter's account
     *  may be deleted without evicting the collaborator (V10). */
    @Column(name = "invited_by")
    private UUID invitedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public SongCollaborator(UUID songId, UUID userId, CollaboratorRole role, UUID invitedBy) {
        this.id = new SongCollaboratorId(songId, userId);
        this.invitedBy = invitedBy;
        changeRole(role); // construction and mutation share one guard
    }

    public void changeRole(CollaboratorRole newRole) {
        if (newRole == null) {
            throw new IllegalArgumentException("A collaborator must have a role");
        }
        this.role = newRole;
    }

    public UUID getSongId() {
        return id.getSongId();
    }

    public UUID getUserId() {
        return id.getUserId();
    }

    /**
     * Identity-based, keyed on the composite id — same contract as
     * Song.equals (see Song.java). The id itself is a value object with
     * field-based equality; the ENTITY is equal iff it has the same id.
     */
    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof SongCollaborator collaborator)) {
            return false;
        }
        return id != null && id.equals(collaborator.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(SongCollaborator.class);
    }
}
