package com.cotune.beat;

import com.cotune.song.Song;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * A named multi-instrument pattern — "Beat 1", "Beat 2" — the FL-Studio
 * pattern model. A beat GROUPS instrument lanes (Track rows) that play
 * together; the arrangement (Clip) places whole beats on the timeline.
 *
 * Same one-directional modeling as everywhere else: Beat points at Song,
 * Track points at Beat, no collections on the parent side — the graph
 * shape lives in GraphQL batch resolvers.
 */
@Entity
@Table(name = "beats")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Beat {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "song_id", nullable = false, updatable = false)
    private Song song;

    @Column(nullable = false, length = 80)
    private String name;

    // 0-based slot in the song's beat list, server-assigned (max + 1) —
    // same ordering contract as track lanes.
    @Column(nullable = false)
    private int position;

    // How many 16-step bars this beat's patterns span. New beats start at
    // the classic single bar; growing/shrinking is a deliberate edit
    // (changeBars), and shrinking is guarded in the service where the
    // lane patterns are visible.
    @Column(nullable = false)
    private int bars = 1;

    @Version
    @Column(nullable = false)
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Beat(Song song, String name, int position) {
        if (song == null) {
            throw new IllegalArgumentException("Beat must belong to a song");
        }
        if (position < 0) {
            throw new IllegalArgumentException("Beat position must be >= 0, got " + position);
        }
        this.song = song;
        this.position = position;
        rename(name);
    }

    public void rename(String newName) {
        if (newName == null || newName.isBlank()) {
            throw new IllegalArgumentException("Beat name must not be blank");
        }
        this.name = newName.strip();
    }

    /** Upper bound mirrored by the V8 CHECK constraint — change both. */
    public static final int MAX_BARS = 8;

    /** Total 16th-note steps this beat's patterns may span. */
    public int totalSteps() {
        return bars * 16;
    }

    public void changeBars(int newBars) {
        if (newBars < 1 || newBars > MAX_BARS) {
            throw new IllegalArgumentException(
                    "bars must be 1..%d, got %d".formatted(MAX_BARS, newBars));
        }
        this.bars = newBars;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof Beat beat)) {
            return false;
        }
        return id != null && id.equals(beat.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(Beat.class);
    }
}
