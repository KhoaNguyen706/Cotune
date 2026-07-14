package com.cotune.song;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A song project — the top-level thing collaborators edit together.
 *
 * This is a rich domain object, not a bag of getters/setters: state changes
 * go through intention-revealing methods (rename, changeTempo, ...) so the
 * entity can defend its own invariants. Nothing outside this class can put
 * a Song into an invalid state.
 *
 * Lombok rules on entities: @Getter is safe. @Setter would reopen the
 * anemic-model hole we just closed. @Data / @EqualsAndHashCode / @ToString
 * are BANNED here — they generate field-based equals/hashCode (breaks
 * Hibernate's identity semantics, see below) and toString() that touches
 * every field (triggers lazy-loading once we add relations).
 */
@Entity
@Table(name = "songs")
@Getter
// JPA requires a no-arg constructor to hydrate entities via reflection;
// PROTECTED so application code cannot create a half-initialized Song.
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Song {

    // Musically sane bounds; the DB and DTO validation repeat them, but the
    // entity enforces them too so no code path (batch job, test, future
    // message consumer) can bypass the rule by skipping the API layer.
    public static final int MIN_BPM = 20;
    public static final int MAX_BPM = 400;

    @Id
    // UUIDs are generated app-side, not by a DB sequence. In a collaborative
    // system clients/servers can mint IDs without a round-trip to the DB,
    // and IDs never collide across environments (imports, replication).
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(nullable = false)
    private int bpm;

    @Column(name = "time_signature", nullable = false, length = 10)
    private String timeSignature;

    // A plain UUID column, NOT @ManyToOne(User): the song feature needs the
    // owner's IDENTITY for authorization, never the User object itself.
    // Referencing the entity would couple com.cotune.song to com.cotune.user
    // and invite accidental joins; the FK constraint still lives in the
    // database (V5) where referential integrity belongs. Nullable only for
    // rows that predate ownership.
    @Column(name = "owner_id", updatable = false)
    private UUID ownerId;

    // The public listen link's secret (V12). NULL = no link. Held on the
    // song row rather than a separate table because a song has at most ONE
    // link and the token's whole lifecycle is "set, look up, clear".
    @Column(name = "listen_token", length = 43)
    private String listenToken;

    // Optimistic locking: Hibernate adds "WHERE version = ?" to every UPDATE
    // and bumps the counter. If two collaborators save concurrently, the
    // second write fails with OptimisticLockException instead of silently
    // overwriting the first — the foundation for conflict handling later.
    @Version
    @Column(nullable = false)
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Song(String title, int bpm, String timeSignature, UUID ownerId) {
        if (ownerId == null) {
            throw new IllegalArgumentException("A new song must have an owner");
        }
        this.ownerId = ownerId;
        // Reuse the guarded mutators instead of assigning fields directly,
        // so construction and mutation enforce the exact same invariants.
        rename(title);
        changeTempo(bpm);
        changeTimeSignature(timeSignature);
    }

    public void rename(String newTitle) {
        if (newTitle == null || newTitle.isBlank()) {
            throw new IllegalArgumentException("Song title must not be blank");
        }
        this.title = newTitle.strip();
    }

    public void changeTempo(int newBpm) {
        if (newBpm < MIN_BPM || newBpm > MAX_BPM) {
            throw new IllegalArgumentException(
                    "BPM must be between %d and %d, got %d".formatted(MIN_BPM, MAX_BPM, newBpm));
        }
        this.bpm = newBpm;
    }

    public void changeTimeSignature(String newTimeSignature) {
        if (newTimeSignature == null || !newTimeSignature.matches("\\d{1,2}/\\d{1,2}")) {
            throw new IllegalArgumentException(
                    "Time signature must look like 4/4, got: " + newTimeSignature);
        }
        this.timeSignature = newTimeSignature;
    }

    /**
     * The token itself is minted by the SERVICE (entities don't own a
     * SecureRandom); the entity only guards that whatever goes in could
     * plausibly be one. Idempotence ("enabling twice keeps the same link")
     * is the service's rule too — this method just stores.
     */
    public void enableListenLink(String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("Listen token must not be blank");
        }
        this.listenToken = token;
    }

    /** Revoke: every copy of the old link stops working immediately. */
    public void disableListenLink() {
        this.listenToken = null;
    }

    /**
     * Identity-based equality, JPA style — hand-written on purpose, this is
     * the one place Lombok must not be used. Two Songs are "the same" iff
     * they have the same persistent id. We do NOT compare fields: an
     * entity's fields change over its lifetime, and Hibernate keeps
     * entities in hash-based collections where a mutating hashCode
     * corrupts the set.
     */
    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        // instanceof (not getClass()) so Hibernate lazy-loading proxies,
        // which are runtime subclasses of Song, still compare as equal.
        if (!(other instanceof Song song)) {
            return false;
        }
        // A transient (not-yet-saved) Song has a null id and is equal to
        // nothing but itself — handled by the reference check above.
        return id != null && id.equals(song.id);
    }

    @Override
    public int hashCode() {
        // Constant per class, not derived from id: id is null before the
        // first save, and hashCode must not change after insertion into a
        // HashSet. This trades hash distribution for correctness.
        return Objects.hash(Song.class);
    }
}
