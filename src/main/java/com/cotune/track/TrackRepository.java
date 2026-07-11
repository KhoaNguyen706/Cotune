package com.cotune.track;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
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

    // Ownership resolution for TrackAccess: lane → beat → song in one
    // join, no entity hydration. Empty when the track doesn't exist.
    @Query("select t.beat.song.id from Track t where t.id = :id")
    Optional<UUID> findSongIdById(@Param("id") UUID id);

    /**
     * Load a lane for a read-modify-write, holding the row until commit
     * (SELECT ... FOR UPDATE).
     *
     * WHY PESSIMISTIC HERE, WHEN EVERY OTHER WRITE IN THIS CODEBASE IS
     * OPTIMISTIC: optimistic locking is right when the CLIENT supplies the
     * version it started from — it can be told "someone got there first,
     * reload" and a human decides what to do. Applying a note op has no such
     * client expectation to honour: the op is a delta, it is valid against
     * whatever the lane currently holds, and the only correct response to a
     * concurrent write is to apply it anyway. Optimistic locking here would
     * mean catching OptimisticLockException and retrying in a loop — which is
     * a lock, just spelled with more code and more round trips.
     *
     * The lane row is held for the microseconds it takes to merge one note, so
     * the usual objection to pessimistic locking (long-held locks strangle
     * throughput) does not apply. The two ops that race are serialized; both
     * survive. That is exactly the behaviour we are buying.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Track t where t.id = :id")
    Optional<Track> findByIdForUpdate(@Param("id") UUID id);
}
