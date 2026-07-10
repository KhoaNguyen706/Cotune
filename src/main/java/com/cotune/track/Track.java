package com.cotune.track;

import com.cotune.beat.Beat;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * One instrument lane inside a BEAT (since V7 — lanes used to hang off the
 * song directly; now "Beat 1" groups the lanes that play together, and the
 * arrangement places whole beats).
 *
 * Deliberate modeling choice: Track points at Beat (@ManyToOne), but Beat
 * has NO @OneToMany collection of tracks. A bidirectional collection means
 * loading a Beat can drag its tracks along, equals/hashCode landmines, and
 * "who owns the relationship" bookkeeping. In a GraphQL service the child
 * side is fetched per-request by the resolver layer (see @BatchMapping in
 * TrackGraphqlController) — the entity graph stays one-directional.
 */
@Entity
@Table(name = "tracks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Track {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    // LAZY: loading a track must not automatically SELECT its beat — we
    // almost always already have the beat in hand. EAGER (the awful JPA
    // default for @ManyToOne!) would join-fetch the beat on every track load.
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "beat_id", nullable = false, updatable = false)
    private Beat beat;

    @Column(nullable = false, length = 80)
    private String name;

    // STRING, never ORDINAL — see Instrument.java for the re-labeling trap.
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Instrument instrument;

    // 0-based slot in the beat's lane list. Assigned by the service
    // (max + 1), not by the client — ordering is server-owned state.
    @Column(nullable = false)
    private int position;

    // The beat itself. @JdbcTypeCode(JSON) tells Hibernate to serialize the
    // list to the JSONB column via Jackson — the List<Step> is a plain Java
    // object in memory and one jsonb value in the row. No extra table, no
    // join; the trade-off is documented in V4__add_track_pattern.sql.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private List<Step> pattern = new ArrayList<>();

    @Version
    @Column(nullable = false)
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Track(Beat beat, String name, Instrument instrument, int position) {
        if (beat == null) {
            throw new IllegalArgumentException("Track must belong to a beat");
        }
        if (position < 0) {
            throw new IllegalArgumentException("Track position must be >= 0, got " + position);
        }
        this.beat = beat;
        this.position = position;
        rename(name);
        changeInstrument(instrument);
    }

    public void rename(String newName) {
        if (newName == null || newName.isBlank()) {
            throw new IllegalArgumentException("Track name must not be blank");
        }
        this.name = newName.strip();
    }

    public void changeInstrument(Instrument newInstrument) {
        if (newInstrument == null) {
            throw new IllegalArgumentException("Track instrument must not be null");
        }
        this.instrument = newInstrument;
    }

    /**
     * Whole-pattern replacement, not add/removeNote: the client edits a
     * grid and saves the grid — one intention, one method. (Fine-grained
     * note operations only become necessary for real-time collab, where
     * two people edit the SAME pattern concurrently.)
     *
     * Each Step validated itself at construction; the pattern-level rules
     * (size cap, no duplicate step+pitch) live here because they're about
     * the collection, not any single note.
     */
    public void replacePattern(List<Step> newPattern) {
        if (newPattern == null) {
            throw new IllegalArgumentException("Pattern must not be null (use an empty list to clear)");
        }
        // 16 steps x a generous chord/polyphony allowance. A cap matters
        // because this arrives from the network: without one, a malicious
        // 10MB pattern is a storage/bandwidth attack wearing a beat costume.
        if (newPattern.size() > 256) {
            throw new IllegalArgumentException("Pattern too large: max 256 events");
        }
        long distinct = newPattern.stream().map(s -> s.step() + "|" + s.pitch()).distinct().count();
        if (distinct != newPattern.size()) {
            throw new IllegalArgumentException("Pattern has duplicate events for the same step and pitch");
        }
        // Defensive copy — nobody outside can mutate our state through a
        // list reference they kept.
        this.pattern = new ArrayList<>(newPattern);
    }

    /**
     * Hand-written to shadow Lombok's getter: hands out an unmodifiable
     * view, so the ONLY way to change the pattern is replacePattern()
     * with its validation. A raw getter would reopen the anemic-model
     * hole for this one field.
     */
    public List<Step> getPattern() {
        return List.copyOf(pattern);
    }

    // Same identity-based equals/hashCode contract as Song — see the long
    // explanation there; the reasoning is identical for every entity.
    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof Track track)) {
            return false;
        }
        return id != null && id.equals(track.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(Track.class);
    }
}
