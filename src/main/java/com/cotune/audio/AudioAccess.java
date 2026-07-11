package com.cotune.audio;

import com.cotune.song.SongAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/** Audio file → song, then delegate — see BeatAccess for the pattern. */
@Component("audioAccess")
@RequiredArgsConstructor
public class AudioAccess {

    private final AudioFileRepository audioFileRepository;
    private final SongAccess songAccess;

    @Transactional(readOnly = true)
    public boolean canEdit(UUID audioFileId, Authentication authentication) {
        return audioFileRepository.findSongIdById(audioFileId)
                .map(songId -> songAccess.canEdit(songId, authentication))
                .orElse(true);
    }

    /**
     * May they DOWNLOAD these bytes?
     *
     * Until V10 the download endpoint had no object-level rule at all — being
     * logged in was enough, so any account could stream any other account's
     * uploaded audio just by knowing (or guessing at) an id. The bytes are the
     * most private thing in the system; they were the least protected.
     *
     * Worth naming the trap: the endpoint LOOKED covered, because /api/** is
     * locked to authenticated users in SecurityConfig. Authentication is not
     * authorization, and a URL rule cannot express "…and it has to be yours".
     */
    @Transactional(readOnly = true)
    public boolean canView(UUID audioFileId, Authentication authentication) {
        return audioFileRepository.findSongIdById(audioFileId)
                .map(songId -> songAccess.canView(songId, authentication))
                .orElse(true); // missing → let the service answer NOT_FOUND
    }
}
