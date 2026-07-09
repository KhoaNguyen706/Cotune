package com.cotune.song;

import org.springframework.data.jpa.repository.JpaRepository;

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
}
