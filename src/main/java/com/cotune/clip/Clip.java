package com.cotune.clip;

import com.cotune.audio.AudioFile;
import com.cotune.beat.Beat;
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
 * One placement on the arrangement timeline — the video-editor model:
 * media (a beat, an audio file) never moves; CLIPS are the edit. Since V7
 * a BEAT clip places a whole multi-instrument beat ("Beat 1" = kick +
 * snare + bass together); the same beat placed five times = five clips,
 * one pattern group.
 *
 * Time is measured in 16th-note steps (16 = one 4/4 bar), not seconds:
 * change the song's BPM and the arrangement stays musically identical.
 */
@Entity
@Table(name = "clips")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Clip {

    /** 128 bars — a sanity ceiling, not a musical rule. Bounds what a
     *  hostile client can make the editor render/schedule. */
    public static final int MAX_TIMELINE_STEPS = 16 * 128;

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "song_id", nullable = false, updatable = false)
    private Song song;

    @Column(nullable = false)
    private int lane;

    @Column(name = "start_step", nullable = false)
    private int startStep;

    @Column(name = "length_steps", nullable = false)
    private int lengthSteps;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ClipType type;

    // Exactly one of the two references is set, matching `type` — the DB
    // CHECK constraint (V7) enforces it below the JVM too.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "beat_id", updatable = false)
    private Beat beat;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "audio_id", updatable = false)
    private AudioFile audioFile;

    @Version
    @Column(nullable = false)
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    private Clip(Song song, int lane, int startStep, int lengthSteps) {
        if (song == null) {
            throw new IllegalArgumentException("Clip must belong to a song");
        }
        this.song = song;
        place(lane, startStep, lengthSteps);
    }

    /** A beat placement: every lane of `beat` loops for lengthSteps. */
    public static Clip forBeat(Song song, Beat beat, int lane, int startStep, int lengthSteps) {
        if (beat == null) {
            throw new IllegalArgumentException("Beat clip needs a beat reference");
        }
        Clip clip = new Clip(song, lane, startStep, lengthSteps);
        clip.type = ClipType.BEAT;
        clip.beat = beat;
        return clip;
    }

    /** An audio placement: the file plays from startStep. */
    public static Clip forAudio(Song song, AudioFile audioFile, int lane, int startStep, int lengthSteps) {
        if (audioFile == null) {
            throw new IllegalArgumentException("Audio clip needs an audio file reference");
        }
        Clip clip = new Clip(song, lane, startStep, lengthSteps);
        clip.type = ClipType.AUDIO;
        clip.audioFile = audioFile;
        return clip;
    }

    /**
     * Move AND resize in one intention — the editor's drag gestures always
     * know the full target geometry, and one method means one place for
     * the bounds rules.
     */
    public void place(int lane, int startStep, int lengthSteps) {
        if (lane < 0) {
            throw new IllegalArgumentException("Clip lane must be >= 0, got " + lane);
        }
        if (startStep < 0) {
            throw new IllegalArgumentException("Clip startStep must be >= 0, got " + startStep);
        }
        if (lengthSteps <= 0) {
            throw new IllegalArgumentException("Clip lengthSteps must be > 0, got " + lengthSteps);
        }
        if (startStep + lengthSteps > MAX_TIMELINE_STEPS) {
            throw new IllegalArgumentException(
                    "Clip extends past the timeline end (max " + MAX_TIMELINE_STEPS + " steps)");
        }
        this.lane = lane;
        this.startStep = startStep;
        this.lengthSteps = lengthSteps;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof Clip clip)) {
            return false;
        }
        return id != null && id.equals(clip.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(Clip.class);
    }
}
