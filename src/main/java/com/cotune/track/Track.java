package com.cotune.track;

import com.cotune.song.Song;
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
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * One instrument lane inside a song (what the frontend will render as a
 * horizontal strip in the editor).
 *
 * Deliberate modeling choice: Track points at Song (@ManyToOne), but Song
 * has NO @OneToMany collection of tracks. A bidirectional collection means
 * loading a Song can drag its tracks along, equals/hashCode landmines, and
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

    // LAZY: loading a track must not automatically SELECT its song — we
    // almost always already have the song in hand. EAGER (the awful JPA
    // default for @ManyToOne!) would join-fetch the song on every track load.
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "song_id", nullable = false, updatable = false)
    private Song song;

    @Column(nullable = false, length = 80)
    private String name;

    // STRING, never ORDINAL — see Instrument.java for the re-labeling trap.
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Instrument instrument;

    // 0-based slot in the song's track list. Assigned by the service
    // (max + 1), not by the client — ordering is server-owned state.
    @Column(nullable = false)
    private int position;

    @Version
    @Column(nullable = false)
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Track(Song song, String name, Instrument instrument, int position) {
        if (song == null) {
            throw new IllegalArgumentException("Track must belong to a song");
        }
        if (position < 0) {
            throw new IllegalArgumentException("Track position must be >= 0, got " + position);
        }
        this.song = song;
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
