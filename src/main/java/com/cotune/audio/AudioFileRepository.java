package com.cotune.audio;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AudioFileRepository extends JpaRepository<AudioFile, UUID> {

    /**
     * Constructor-expression projection: SELECTs every column EXCEPT the
     * bytea payload. Listing a song's audio must not drag megabytes of
     * sample data across the wire from Postgres — the bytes are only ever
     * loaded one file at a time by the download endpoint (findById).
     */
    @Query("""
            select new com.cotune.audio.AudioFileSummary(
                a.id, a.song.id, a.filename, a.contentType,
                a.sizeBytes, a.durationSeconds, a.createdAt)
            from AudioFile a
            where a.song.id in :songIds
            order by a.createdAt asc
            """)
    List<AudioFileSummary> findSummariesBySongIds(@Param("songIds") List<UUID> songIds);

    // Referential guard for clip placement — exists-check only, so the
    // bytea payload is never touched.
    boolean existsByIdAndSongId(UUID id, UUID songId);

    // Ownership resolution for AudioAccess. Deliberately NOT findById +
    // getSong(): that would hydrate the bytea payload just to read an id.
    @Query("select a.song.id from AudioFile a where a.id = :id")
    Optional<UUID> findSongIdById(@Param("id") UUID id);
}
