package com.cotune.chat;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {

    /**
     * Newest first, because "the latest N" is the page a chat opens on; the
     * service reverses into reading order. Pageable rather than a Top50
     * method name so the page size is the SERVICE's stated decision instead
     * of a number fossilized into a method name. The id tiebreak matches
     * the V11 index exactly — same columns, same directions — so Postgres
     * walks the index instead of sorting.
     */
    @Query("select m from ChatMessage m where m.song.id = :songId order by m.createdAt desc, m.id desc")
    List<ChatMessage> findRecent(@Param("songId") UUID songId, Pageable page);
}
