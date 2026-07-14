package com.cotune.listen;

import com.cotune.audio.dto.AudioContent;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.UUID;

/**
 * The one PUBLIC route under /api (SecurityConfig permits exactly this
 * GET shape): audio bytes for a song shared by listen link. The token in
 * the path is the authorization — the service verifies it resolves AND
 * that the audio belongs to that song, so a token for song A cannot
 * stream song B's uploads.
 */
@RestController
@RequiredArgsConstructor
public class ListenRestController {

    private final ListenService listenService;

    @GetMapping("/api/listen/{token}/audio/{audioId}")
    public ResponseEntity<byte[]> audio(@PathVariable String token, @PathVariable UUID audioId) {
        AudioContent content = listenService.audioByToken(token, audioId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(content.contentType()))
                // private: this URL embeds a secret, so shared caches (CDN,
                // proxy) must not store it; the LISTENER'S browser may — audio
                // is immutable by id, so a day of reuse is free bandwidth.
                .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePrivate())
                // No Content-Disposition filename on purpose — the DTO note:
                // upload filenames are not something a share link publishes.
                .body(content.bytes());
    }
}
