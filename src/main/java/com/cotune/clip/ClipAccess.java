package com.cotune.clip;

import com.cotune.song.SongAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/** Clip → song, then delegate — see BeatAccess for the pattern. */
@Component("clipAccess")
@RequiredArgsConstructor
public class ClipAccess {

    private final ClipRepository clipRepository;
    private final SongAccess songAccess;

    @Transactional(readOnly = true)
    public boolean canEdit(UUID clipId, Authentication authentication) {
        return clipRepository.findSongIdById(clipId)
                .map(songId -> songAccess.canEdit(songId, authentication))
                .orElse(true);
    }
}
