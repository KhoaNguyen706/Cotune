package com.cotune.song;

import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.dto.CreateSongInput;
import com.cotune.song.dto.SongDto;
import com.cotune.song.dto.UpdateSongInput;
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

    @Override
    public SongDto create(CreateSongInput input, UUID ownerId) {
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
    public List<SongDto> getAll() {
        // Unpaged is acceptable only while this is a dev-scale table.
        // Session goal for later: switch to Pageable before any real data —
        // findAll() on a big table is a classic production incident.
        return songRepository.findAll().stream()
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
