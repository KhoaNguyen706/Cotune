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
}
