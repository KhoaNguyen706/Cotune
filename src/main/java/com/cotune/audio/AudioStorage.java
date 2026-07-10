package com.cotune.audio;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/**
 * File-system home for uploaded audio bytes. Deliberately dumb: store,
 * load, delete — no knowledge of songs or entities. Swapping this for an
 * S3/GCS client later touches exactly this class (same seam object
 * storage would use).
 *
 * Files are named by a fresh UUID, never by user input — the uploaded
 * filename is display metadata in the DB, not a path. That kills path
 * traversal by construction.
 */
@Component
public class AudioStorage {

    private final Path root;

    public AudioStorage(@Value("${cotune.storage.audio-dir}") String audioDir) {
        this.root = Path.of(audioDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot create audio storage dir: " + root, e);
        }
    }

    /** Writes the bytes; returns the RELATIVE path to persist on the row. */
    public String store(byte[] bytes) {
        String name = UUID.randomUUID() + ".bin";
        try {
            Files.write(root.resolve(name), bytes);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to store audio file " + name, e);
        }
        return name;
    }

    public byte[] load(String relativePath) {
        try {
            return Files.readAllBytes(resolve(relativePath));
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to read audio file " + relativePath, e);
        }
    }

    /** Best-effort: a leftover orphan file is annoying; a failed delete
     *  request because the file already vanished would be worse. */
    public void delete(String relativePath) {
        try {
            Files.deleteIfExists(resolve(relativePath));
        } catch (IOException e) {
            // Swallowed by design — the DB row is already gone; log-worthy
            // at most. (No logger in this class yet; orphans are re-sweepable.)
        }
    }

    /** Belt-and-suspenders: even though paths are server-generated, refuse
     *  anything that escapes the root. */
    private Path resolve(String relativePath) {
        Path resolved = root.resolve(relativePath).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException("Illegal storage path: " + relativePath);
        }
        return resolved;
    }
}
