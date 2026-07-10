package com.cotune.beat;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface BeatRepository extends JpaRepository<Beat, UUID> {

    List<Beat> findBySongIdInOrderByPositionAsc(Collection<UUID> songIds);

    @Query("select coalesce(max(b.position), -1) from Beat b where b.song.id = :songId")
    int findMaxPositionBySongId(@Param("songId") UUID songId);

    // Referential guard for clip placement (a clip may only place a beat
    // from its own song).
    boolean existsByIdAndSongId(UUID id, UUID songId);
}
