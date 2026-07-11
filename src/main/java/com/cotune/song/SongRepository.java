package com.cotune.song;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data generates the implementation at runtime (a proxy backed by
 * Hibernate). We write zero SQL for standard CRUD; derived query methods
 * (e.g. findByTitleContainingIgnoreCase) get added here as the domain grows.
 *
 * This interface is the ONLY place the persistence mechanism leaks into the
 * feature package — services depend on this abstraction, never on
 * EntityManager directly. That is the repository pattern.
 */
public interface SongRepository extends JpaRepository<Song, UUID> {

    /**
     * Every song the user may open: the ones they own, plus the ones they
     * have been invited to.
     *
     * THIS METHOD IS A SECURITY BOUNDARY, not a convenience filter. Until
     * V10 the songs query called findAll(), so every logged-in user was
     * served every other user's work — the kind of hole that survives for
     * months because the UI never asks for anything it shouldn't and so
     * nobody sees it. Listing endpoints must filter in the DATABASE; a
     * filter applied after the fetch is one forgotten `.stream()` away from
     * leaking, and it drags rows the caller may not see through the app.
     *
     * EXISTS rather than `s.id IN (SELECT ...)`: the subquery can stop at
     * the first matching membership row, and — unlike IN — it has no
     * surprises if the subquery ever yields NULLs. Both hit the composite
     * primary key from V10, so the lookup is an index probe per song.
     *
     * Ownerless legacy songs (owner_id IS NULL) match nothing here and so
     * appear in nobody's list; that is intended. `= NULL` is never true in
     * SQL, which for once is exactly the semantics we want.
     */
    @Query("""
            select s from Song s
            where s.ownerId = :userId
               or exists (
                   select 1 from SongCollaborator c
                   where c.id.songId = s.id and c.id.userId = :userId
               )
            order by s.createdAt desc
            """)
    List<Song> findAllVisibleTo(@Param("userId") UUID userId);
}
