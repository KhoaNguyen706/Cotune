package com.cotune.track;

import com.cotune.song.SongAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/** Lane → beat → song, then delegate — see BeatAccess for the pattern. */
@Component("trackAccess")
@RequiredArgsConstructor
public class TrackAccess {

    private final TrackRepository trackRepository;
    private final SongAccess songAccess;

    @Transactional(readOnly = true)
    public boolean canEdit(UUID trackId, Authentication authentication) {
        return trackRepository.findSongIdById(trackId)
                .map(songId -> songAccess.canEdit(songId, authentication))
                .orElse(true);
    }

    @Transactional(readOnly = true)
    public boolean canView(UUID trackId, Authentication authentication) {
        return trackRepository.findSongIdById(trackId)
                .map(songId -> songAccess.canView(songId, authentication))
                .orElse(true);
    }
}
