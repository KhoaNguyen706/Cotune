package com.cotune.beat;

import com.cotune.song.SongAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Object-level rule for beat mutations: resolve the beat UP to its song
 * and delegate — the ownership decision itself lives only in SongAccess.
 * Missing beat → true, so the service answers NOT_FOUND instead of this
 * check leaking id existence via FORBIDDEN (same convention as SongAccess).
 */
@Component("beatAccess")
@RequiredArgsConstructor
public class BeatAccess {

    private final BeatRepository beatRepository;
    private final SongAccess songAccess;

    @Transactional(readOnly = true)
    public boolean canEdit(UUID beatId, Authentication authentication) {
        return beatRepository.findSongIdById(beatId)
                .map(songId -> songAccess.canEdit(songId, authentication))
                .orElse(true);
    }
}
