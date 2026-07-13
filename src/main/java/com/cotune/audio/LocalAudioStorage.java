package com.cotune.audio;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/**
 * Bytes on the local filesystem. The behaviour the app has had since V9, now
 * merely named — and scoped to the places where a local disk is actually a
 * durable thing: your laptop, and docker-compose (where the named volume
 * outlives the container and BOTH app instances mount the same one).
 *
 * It stays the DEFAULT (matchIfMissing = true) for the same reason
 * LocalBroadcaster does: a new contributor running `docker compose up` should
 * not need cloud credentials to upload a wav file.
 *
 * It is exactly the WRONG choice on Heroku — see AudioStorage.
 */
@Component
@ConditionalOnProperty(name = "cotune.storage.backend", havingValue = "local", matchIfMissing = true)
public class LocalAudioStorage implements AudioStorage {

    private final Path root;

    public LocalAudioStorage(@Value("${cotune.storage.audio-dir}") String audioDir) {
        this.root = Path.of(audioDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot create audio storage dir: " + root, e);
        }
    }

    @Override
    public String store(byte[] bytes) {
        String name = UUID.randomUUID() + ".bin";
        try {
            Files.write(root.resolve(name), bytes);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to store audio file " + name, e);
        }
        return name;
    }

    @Override
    public byte[] load(String storagePath) {
        try {
            return Files.readAllBytes(resolve(storagePath));
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to read audio file " + storagePath, e);
        }
    }

    @Override
    public void delete(String storagePath) {
        try {
            Files.deleteIfExists(resolve(storagePath));
        } catch (IOException e) {
            // Swallowed by design — see AudioStorage.delete. Orphans are re-sweepable.
        }
    }

    /** Belt-and-suspenders: even though paths are server-generated, refuse
     *  anything that escapes the root. */
    private Path resolve(String storagePath) {
        Path resolved = root.resolve(storagePath).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException("Illegal storage path: " + storagePath);
        }
        return resolved;
    }
}
