package com.cotune.listen;

import com.cotune.audio.AudioFileRepository;
import com.cotune.audio.AudioService;
import com.cotune.audio.dto.AudioContent;
import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.listen.dto.ListenAudioDto;
import com.cotune.listen.dto.ListenBeatDto;
import com.cotune.listen.dto.ListenClipDto;
import com.cotune.listen.dto.ListenSongDto;
import com.cotune.listen.dto.ListenTrackDto;
import com.cotune.clip.ClipRepository;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import com.cotune.track.Track;
import com.cotune.track.TrackRepository;
import com.cotune.track.dto.StepDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Cross-feature READS of beat/track/clip/audio data, the SongDescriber
 * precedent: reading another feature's rows is allowed, writing is not.
 * The only rows this service ever writes are the songs.listen_token column
 * it owns.
 */
@Service
@RequiredArgsConstructor
public class ListenServiceImpl implements ListenService {

    // 32 random bytes → 43 base64url chars: the token must be UNGUESSABLE,
    // because holding it is the entire authorization. SecureRandom is
    // thread-safe and cheap to share.
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SongRepository songRepository;
    private final BeatRepository beatRepository;
    private final TrackRepository trackRepository;
    private final ClipRepository clipRepository;
    private final AudioFileRepository audioFileRepository;
    private final AudioService audioService;

    @Override
    @Transactional
    public String enableListenLink(UUID songId) {
        Song song = songRepository.findById(songId)
                .orElseThrow(() -> ResourceNotFoundException.song(songId));
        if (song.getListenToken() == null) {
            byte[] bytes = new byte[32];
            RANDOM.nextBytes(bytes);
            song.enableListenLink(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes));
        }
        return song.getListenToken();
    }

    @Override
    @Transactional
    public void disableListenLink(UUID songId) {
        Song song = songRepository.findById(songId)
                .orElseThrow(() -> ResourceNotFoundException.song(songId));
        song.disableListenLink();
    }

    @Override
    @Transactional(readOnly = true)
    public ListenSongDto byToken(String token) {
        Song song = resolve(token);
        UUID songId = song.getId();

        List<Beat> beats = beatRepository.findBySongIdInOrderByPositionAsc(List.of(songId));
        Map<UUID, List<Track>> lanesByBeat = trackRepository
                .findByBeatIdInOrderByPositionAsc(beats.stream().map(Beat::getId).toList())
                .stream()
                .collect(Collectors.groupingBy(track -> track.getBeat().getId()));

        return new ListenSongDto(
                song.getTitle(),
                song.getBpm(),
                song.getTimeSignature(),
                beats.stream().map(beat -> new ListenBeatDto(
                        beat.getId(),
                        beat.getName(),
                        beat.getPosition(),
                        beat.getBars(),
                        lanesByBeat.getOrDefault(beat.getId(), List.of()).stream()
                                .map(ListenServiceImpl::toTrackDto)
                                .toList()
                )).toList(),
                clipRepository.findBySongIdInOrderByLaneAscStartStepAsc(List.of(songId)).stream()
                        .map(clip -> new ListenClipDto(
                                clip.getId(),
                                clip.getLane(),
                                clip.getStartStep(),
                                clip.getLengthSteps(),
                                clip.getType(),
                                // Ids off lazy proxies are free — served from
                                // the FK value, no SQL (ClipMapper's note).
                                clip.getBeat() == null ? null : clip.getBeat().getId(),
                                clip.getAudioFile() == null ? null : clip.getAudioFile().getId()
                        )).toList(),
                audioFileRepository.findSummariesBySongIds(List.of(songId)).stream()
                        .map(audio -> new ListenAudioDto(
                                audio.id(), audio.contentType(), audio.durationSeconds()))
                        .toList()
        );
    }

    @Override
    @Transactional(readOnly = true)
    public AudioContent audioByToken(String token, UUID audioId) {
        Song song = resolve(token);
        UUID owningSong = audioFileRepository.findSongIdById(audioId)
                .orElseThrow(() -> ResourceNotFoundException.audioFile(audioId));
        if (!owningSong.equals(song.getId())) {
            // NOT_FOUND, not FORBIDDEN: a 403 would confirm the audio id
            // exists on some other song — this route reveals nothing beyond
            // what the token legitimately opens.
            throw ResourceNotFoundException.audioFile(audioId);
        }
        return audioService.download(audioId);
    }

    private Song resolve(String token) {
        // Blank/null can't match (the entity refuses to store them), but
        // fail fast rather than hand "" to the database.
        if (token == null || token.isBlank()) {
            throw ResourceNotFoundException.listenLink();
        }
        return songRepository.findByListenToken(token)
                .orElseThrow(ResourceNotFoundException::listenLink);
    }

    private static ListenTrackDto toTrackDto(Track track) {
        return new ListenTrackDto(
                track.getId(),
                track.getName(),
                track.getInstrument(),
                track.getPosition(),
                track.getPattern().stream()
                        .map(step -> new StepDto(step.step(), step.pitch(), step.velocity(), step.length()))
                        .toList());
    }
}
