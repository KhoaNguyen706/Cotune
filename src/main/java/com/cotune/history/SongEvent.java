package com.cotune.history;

import com.cotune.track.Step;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * One entry in a song's append-only history: "this actor did this to this
 * lane at this moment." Never updated, never deleted (V15's comment says
 * why) — so unlike every other entity here there is no @Version and no
 * guarded mutators: an object with no second state needs no guards.
 *
 * The ID is a bigserial, not a UUID, and that's load-bearing: replay folds
 * a lane's events IN ORDER, and "in order" must mean insertion order even
 * for two ops in the same millisecond. Sequences give that; timestamps and
 * random UUIDs don't.
 */
@Entity
@Table(name = "song_events")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SongEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "song_id", nullable = false, updatable = false)
    private UUID songId;

    // A bare uuid, not a @ManyToOne: the lane may be deleted later and this
    // row must survive it (no FK in V15, no object reference here).
    @Column(name = "track_id", nullable = false, updatable = false)
    private UUID trackId;

    /** Null = no human: the migration baseline. */
    @Column(name = "actor_id", updatable = false)
    private UUID actorId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20, updatable = false)
    private SongEventType type;

    // Same JSONB trick as Track.pattern: one note for NOTE_ADD/NOTE_REMOVE,
    // the whole grid for PATTERN_SET — one shape, one fold.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb", updatable = false)
    private List<Step> payload = new ArrayList<>();

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public SongEvent(UUID songId, UUID trackId, UUID actorId,
                     SongEventType type, List<Step> payload) {
        if (songId == null || trackId == null || type == null || payload == null) {
            throw new IllegalArgumentException("Song event fields must not be null");
        }
        this.songId = songId;
        this.trackId = trackId;
        this.actorId = actorId;
        this.type = type;
        this.payload = new ArrayList<>(payload);
    }

    public List<Step> getPayload() {
        return List.copyOf(payload);
    }
}
