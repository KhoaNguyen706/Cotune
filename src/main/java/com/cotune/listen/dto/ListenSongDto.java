package com.cotune.listen.dto;

import java.util.List;

/**
 * A song as a PUBLIC LISTENER sees it — which is the point of these types
 * existing at all. The listen query cannot return the Song graph type: its
 * nested resolvers demand a logged-in user, and reusing it would drag
 * private fields (collaborator emails, roles, owner id) one forgotten
 * @PreAuthorize away from the open internet. This record IS the public
 * surface: what's listed here leaks, nothing else can.
 *
 * The shape is exactly what playback needs and nothing more — no ids on
 * the song (the token is the address), no versions, no timestamps, no
 * filenames (an upload's filename can carry a real name).
 */
public record ListenSongDto(
        String title,
        int bpm,
        String timeSignature,
        List<ListenBeatDto> beats,
        List<ListenClipDto> clips,
        List<ListenAudioDto> audioFiles
) {
}
