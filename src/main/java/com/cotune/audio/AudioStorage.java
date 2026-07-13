package com.cotune.audio;

/**
 * Where uploaded audio bytes live. Deliberately dumb: store, load, delete — no
 * knowledge of songs or entities.
 *
 * SESSION 20 MADE THIS AN INTERFACE, and the reason is the same shape as the
 * Redis relay: something that is correct on one machine is silently wrong on
 * two. LocalAudioStorage writes to the container's filesystem, which works
 * beautifully in docker-compose because both app containers mount the SAME
 * named volume. On a real platform they do not:
 *
 *   - Heroku's dyno filesystem is EPHEMERAL and dynos are cycled at least
 *     once every 24h (plus on every deploy and every config change). Uploaded
 *     samples are gone by tomorrow — on ONE dyno. This is not a scaling
 *     problem there, it is a "the feature does not work" problem.
 *   - And with two dynos, a file uploaded to A simply 404s from B.
 *
 * So production points at object storage instead (SupabaseAudioStorage), and
 * the choice is `cotune.storage.backend` — config, not a code path. The old
 * class comment said "swapping this for an S3/GCS client later touches exactly
 * this class". It was right; this is that swap.
 *
 * Files are named by a fresh UUID, never by user input — the uploaded filename
 * is display metadata in the DB, not a path. That kills path traversal by
 * construction, in both implementations.
 */
public interface AudioStorage {

    /** Writes the bytes; returns the storage key to persist on the row. */
    String store(byte[] bytes);

    byte[] load(String storagePath);

    /**
     * Best-effort. A leftover orphan object is annoying; a failed delete because
     * the object already vanished would be worse — the DB row is already gone by
     * the time we get here, so there is nothing useful to do with the error.
     */
    void delete(String storagePath);
}
