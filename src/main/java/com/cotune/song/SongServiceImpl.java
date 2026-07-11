package com.cotune.song;

import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.exception.StaleAccountException;
import com.cotune.common.exception.StaleVersionException;
import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongInput;
import com.cotune.song.dto.UpdateSongPatch;
import com.cotune.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Transaction boundaries live HERE, not in the controller (transport
 * concerns) and not in the repository (too fine-grained: a use case may
 * touch several repositories and must commit or roll back as one unit).
 */
@Service
@Transactional
// Lombok generates a constructor taking every FINAL field — i.e. constructor
// injection without the boilerplate. Spring sees a single constructor and
// autowires it (no @Autowired needed). Final fields mean the service is
// immutable after construction, impossible to half-wire, and unit-testable
// by passing fakes — no Spring context required.
@RequiredArgsConstructor
public class SongServiceImpl implements SongService {

    private final SongRepository songRepository;
    private final SongMapper songMapper;
    private final UserRepository userRepository;

    @Override
    public SongDto create(CreateSongInput input, UUID ownerId) {
        // The token's signature proves WHO issued it, not that the account
        // still exists — a stale-but-valid JWT (deleted account, or a token
        // minted against a different database) would otherwise die on the
        // owner_id FK as an opaque 500. Check first, fail as "re-login".
        if (!userRepository.existsById(ownerId)) {
            throw new StaleAccountException();
        }
        Song song = songMapper.toEntity(input, ownerId);
        // save() returns the managed instance; use the return value, not the
        // argument — for entities with generated fields they can differ.
        Song saved = songRepository.save(song);
        return songMapper.toDto(saved);
    }

    // readOnly=true lets Hibernate skip dirty-checking snapshots and lets
    // the connection pool/database apply read-only optimizations. It also
    // documents intent: this method must not write.
    @Override
    @Transactional(readOnly = true)
    public SongDto getById(UUID id) {
        return songMapper.toDto(loadSong(id));
    }

    @Override
    @Transactional(readOnly = true)
    public List<SongDto> getVisibleTo(UUID userId) {
        // Was findAll() until V10 — i.e. every user was served every other
        // user's songs. The fix is in the QUERY (see findAllVisibleTo), not
        // in a filter here: rows the caller may not see must never be loaded
        // in the first place, or the next person to add a code path that
        // forgets the filter re-opens the hole.
        //
        // Still unpaged, and still only acceptable at dev scale: a user with
        // 10,000 songs would fetch all of them. Pageable before real traffic.
        return songRepository.findAllVisibleTo(userId).stream()
                .map(songMapper::toDto)
                .toList();
    }

    @Override
    public SongDto update(UUID id, UpdateSongInput input) {
        Song song = loadSong(id);

        // No songRepository.save(song) call: `song` is a managed entity
        // inside a transaction, so Hibernate's dirty checking detects the
        // field changes and issues the UPDATE at commit automatically.
        song.rename(input.title());
        song.changeTempo(input.bpm());
        song.changeTimeSignature(input.timeSignature());

        // Without this flush the UPDATE would run after this method returns
        // (at commit), and the DTO we build below would still carry the OLD
        // version/updatedAt. Flushing forces the SQL now so the response
        // reflects what was actually persisted.
        songRepository.flush();
        return songMapper.toDto(song);
    }

    @Override
    public SongDto patch(UUID id, UpdateSongPatch patch) {
        if (patch.isEmpty()) {
            throw new IllegalArgumentException("Patch must change at least one field");
        }
        Song song = loadSong(id);
        StaleVersionException.check("Song", patch.expectedVersion(), song.getVersion());
        // Null = leave unchanged; each present field goes through the same
        // guarded mutator the full update uses, so invariants can't diverge.
        if (patch.title() != null) {
            song.rename(patch.title());
        }
        if (patch.bpm() != null) {
            song.changeTempo(patch.bpm());
        }
        if (patch.timeSignature() != null) {
            song.changeTimeSignature(patch.timeSignature());
        }
        // Flush for the same reason as update(): the returned DTO must
        // carry the bumped version/updatedAt, not the pre-write values.
        songRepository.flush();
        return songMapper.toDto(song);
    }

    @Override
    public void delete(UUID id) {
        // deleteById() is deliberately silent on missing rows (Spring Data
        // contract), but our API promises a NOT_FOUND error for bogus ids,
        // so we check existence explicitly first.
        if (!songRepository.existsById(id)) {
            throw ResourceNotFoundException.song(id);
        }
        songRepository.deleteById(id);
    }

    /**
     * Single choke point for "load or 404" so every use case reports a
     * missing song identically.
     */
    private Song loadSong(UUID id) {
        return songRepository.findById(id)
                .orElseThrow(() -> ResourceNotFoundException.song(id));
    }
}
