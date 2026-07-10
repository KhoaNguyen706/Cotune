package com.cotune.audio;

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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A user-uploaded audio file belonging to a song. Immutable after upload —
 * replacing audio means uploading a new file; the timeline (clips) decides
 * what is actually used. That's the video-editor model: media bin entries
 * never change, edits happen on the timeline.
 *
 * Bytes live in a bytea column (see V6 migration for the trade-off and the
 * promotion path to object storage). IMPORTANT for readers: loading this
 * entity loads the bytes — listing endpoints must use the summary
 * projection in AudioFileRepository, never findAll().
 */
@Entity
@Table(name = "audio_files")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AudioFile {

    /** 15 MB — enough for a several-minute MP3/OGG; a WAV mixdown of a
     *  short loop also fits. Enforced here AND by Spring's multipart limit
     *  (application.yml); the domain check is the guarantee. */
    public static final long MAX_SIZE_BYTES = 15 * 1024 * 1024;

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "song_id", nullable = false, updatable = false)
    private Song song;

    @Column(nullable = false, length = 255)
    private String filename;

    @Column(name = "content_type", nullable = false, length = 100)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    // Measured by the CLIENT at upload time (the browser decodes the file
    // anyway to play it); the server treats audio as opaque bytes.
    @Column(name = "duration_seconds", nullable = false)
    private double durationSeconds;

    @Column(nullable = false)
    private byte[] data;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public AudioFile(Song song, String filename, String contentType,
                     double durationSeconds, byte[] data) {
        if (song == null) {
            throw new IllegalArgumentException("Audio file must belong to a song");
        }
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Audio filename must not be blank");
        }
        // audio/* covers mp3, wav, ogg, flac...; video/webm sneaks real
        // audio-only recordings through some browsers' MediaRecorder, but
        // MVP keeps the contract strict and predictable.
        if (contentType == null || !contentType.startsWith("audio/")) {
            throw new IllegalArgumentException("Only audio uploads are allowed (got " + contentType + ")");
        }
        if (durationSeconds <= 0) {
            throw new IllegalArgumentException("Audio duration must be positive");
        }
        if (data == null || data.length == 0) {
            throw new IllegalArgumentException("Audio upload is empty");
        }
        if (data.length > MAX_SIZE_BYTES) {
            throw new IllegalArgumentException("Audio upload too large: max 15 MB");
        }
        this.song = song;
        // Strip any path a browser might smuggle in; keep the tail.
        String clean = filename.replace("\\", "/");
        clean = clean.substring(clean.lastIndexOf('/') + 1).strip();
        this.filename = clean.length() > 255 ? clean.substring(clean.length() - 255) : clean;
        this.contentType = contentType;
        this.durationSeconds = durationSeconds;
        this.data = data;
        this.sizeBytes = data.length;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof AudioFile file)) {
            return false;
        }
        return id != null && id.equals(file.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(AudioFile.class);
    }
}
