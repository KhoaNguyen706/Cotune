package com.cotune.clip;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ClipRepository extends JpaRepository<Clip, UUID> {

    // Ordered for stable rendering; the batch resolver groups per song.
    List<Clip> findBySongIdInOrderByLaneAscStartStepAsc(List<UUID> songIds);

    // Ownership resolution for ClipAccess — one indexed lookup, no entity
    // hydration. Empty when the clip doesn't exist.
    @Query("select c.song.id from Clip c where c.id = :id")
    Optional<UUID> findSongIdById(@Param("id") UUID id);
}
