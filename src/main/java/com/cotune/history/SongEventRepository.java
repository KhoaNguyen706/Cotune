package com.cotune.history;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SongEventRepository extends JpaRepository<SongEvent, Long> {

    /** The song's history page, newest first (the panel's read). */
    List<SongEvent> findBySongIdOrderByIdDesc(UUID songId, Pageable pageable);

    /** One lane's events up to and including a point in time, oldest
     *  first — exactly the fold order replay needs. */
    List<SongEvent> findByTrackIdAndIdLessThanEqualOrderByIdAsc(UUID trackId, Long eventId);
}
