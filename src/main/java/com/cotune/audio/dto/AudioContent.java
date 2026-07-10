package com.cotune.audio.dto;

/**
 * A downloadable audio payload: the bytes plus the two headers the HTTP
 * response needs. Callers never learn WHERE the bytes lived (disk row or
 * legacy bytea) — that's the service's business.
 */
public record AudioContent(String filename, String contentType, byte[] bytes) {
}
