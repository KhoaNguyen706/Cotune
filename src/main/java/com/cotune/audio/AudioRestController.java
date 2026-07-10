package com.cotune.audio;

import com.cotune.audio.dto.AudioFileDto;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.UUID;

/**
 * Audio bytes ride on REST, not GraphQL — same reasoning as auth: GraphQL
 * is a JSON protocol, and base64-ing megabytes of audio into a JSON field
 * costs 33% size plus a decode on every hop. Multipart up, raw bytes down.
 * Metadata (listing a song's files) still lives in the graph where the
 * editor already queries everything else.
 *
 * All routes sit under /api/** which SecurityConfig locks to authenticated
 * requests — no extra annotations needed (URL-identified operations).
 */
@RestController
@RequiredArgsConstructor
public class AudioRestController {

    private final AudioService audioService;

    // Mutations are owner-only (object-level); download stays open to any
    // authenticated user, same as GraphQL reads.
    @PostMapping(value = "/api/songs/{songId}/audio", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("@songAccess.canEdit(#songId, authentication)")
    public AudioFileDto upload(@PathVariable UUID songId,
                               @RequestParam("file") MultipartFile file,
                               // The browser measured this while decoding for
                               // the preview; the server just records it.
                               @RequestParam("durationSeconds") double durationSeconds) {
        try {
            return audioService.upload(
                    songId,
                    file.getOriginalFilename(),
                    file.getContentType(),
                    durationSeconds,
                    file.getBytes());
        } catch (IOException e) {
            // Disk/stream failure while reading the upload — not the
            // client's fault; let it surface as a 500.
            throw new UncheckedIOException("Failed to read uploaded file", e);
        }
    }

    @GetMapping("/api/audio/{id}")
    public ResponseEntity<byte[]> download(@PathVariable UUID id) {
        AudioFile file = audioService.download(id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.getContentType()))
                // inline: the editor <audio>/decode path streams it; a
                // browser hitting the URL directly still gets the filename
                // when saving. attachment would force a download dialog.
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline().filename(file.getFilename()).build().toString())
                .body(file.getData());
    }

    @DeleteMapping("/api/audio/{id}")
    @PreAuthorize("@audioAccess.canEdit(#id, authentication)")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        audioService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
