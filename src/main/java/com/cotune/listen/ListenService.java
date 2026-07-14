package com.cotune.listen;

import com.cotune.audio.dto.AudioContent;
import com.cotune.listen.dto.ListenSongDto;

import java.util.UUID;

public interface ListenService {

    /**
     * Turn the song's public link on. Idempotent: an existing token is
     * RETURNED, not replaced — "share" clicked twice must not silently
     * kill the link already pasted into a group chat.
     */
    String enableListenLink(UUID songId);

    /** Turn it off. Every copy of the link dies at once. */
    void disableListenLink(UUID songId);

    /** The playback-shaped public read. The token is the authorization. */
    ListenSongDto byToken(String token);

    /**
     * Audio bytes for a clip on a public song. Both facts are checked:
     * the token resolves to a song AND the audio belongs to that song —
     * a valid token for song A must not fetch song B's uploads.
     */
    AudioContent audioByToken(String token, UUID audioId);
}
