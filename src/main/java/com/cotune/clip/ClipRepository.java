package com.cotune.clip;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ClipRepository extends JpaRepository<Clip, UUID> {

    // Ordered for stable rendering; the batch resolver groups per song.
    List<Clip> findBySongIdInOrderByLaneAscStartStepAsc(List<UUID> songIds);
}
