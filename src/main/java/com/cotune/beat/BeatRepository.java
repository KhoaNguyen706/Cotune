package com.cotune.beat;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BeatRepository extends JpaRepository<Beat, UUID> {

    List<Beat> findBySongIdInOrderByPositionAsc(Collection<UUID> songIds);

    @Query("select coalesce(max(b.position), -1) from Beat b where b.song.id = :songId")
    int findMaxPositionBySongId(@Param("songId") UUID songId);

    // Referential guard for clip placement (a clip may only place a beat
    // from its own song).
    boolean existsByIdAndSongId(UUID id, UUID songId);

    // Ownership resolution for BeatAccess — one indexed lookup, no entity
    // hydration. Empty when the beat doesn't exist.
    @Query("select b.song.id from Beat b where b.id = :id")
    Optional<UUID> findSongIdById(@Param("id") UUID id);
}
