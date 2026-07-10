package com.cotune.track;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface TrackRepository extends JpaRepository<Track, UUID> {

    /**
     * Derived query: Spring parses the method name into
     * "WHERE beat.id IN (...) ORDER BY position ASC". One query for ANY
     * number of beats — this is the SQL half of the N+1 fix; the resolver
     * half is @BatchMapping in TrackGraphqlController.
     */
    List<Track> findByBeatIdInOrderByPositionAsc(Collection<UUID> beatIds);

    /**
     * Method-name derivation can't express aggregates like MAX, so this one
     * is explicit JPQL (queries entities/fields, not tables/columns — note
     * `Track t`, not `tracks`). COALESCE turns "beat has no lanes yet"
     * into -1 so the caller's max+1 arithmetic starts at position 0.
     */
    @Query("select coalesce(max(t.position), -1) from Track t where t.beat.id = :beatId")
    int findMaxPositionByBeatId(@Param("beatId") UUID beatId);
}
