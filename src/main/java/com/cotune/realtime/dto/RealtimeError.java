package com.cotune.realtime.dto;

/**
 * Why the server refused an edit, sent to the one client that caused it.
 *
 * A record rather than a bare String, and not for tidiness: a String return
 * value goes out as text/plain, so any client whose converter only speaks JSON
 * silently drops it — the rejection is sent, nobody hears it, and the editor
 * keeps showing a note the server never stored. Wrapping it makes the payload
 * application/json like every other frame on this socket, and it leaves room to
 * add a code or a trackId later without breaking the wire format.
 */
public record RealtimeError(String message) {
}
