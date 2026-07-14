package com.cotune.chat;

import com.cotune.song.Song;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * One line of conversation on a song.
 *
 * IMMUTABLE after creation — note there is no @Version and no setters, and
 * that is not an omission: a chat message is a historical record, not a
 * document. Nothing edits it, so nothing can conflict over it, so it needs
 * no optimistic locking. (Deleting/moderating is a future feature; when it
 * arrives it will be a delete, not an update.)
 *
 * authorName is denormalized from the token at post time and authorId may
 * outlive the account it points to — see V11 for both decisions.
 */
@Entity
@Table(name = "chat_messages")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChatMessage {

    /** Mirrored by the V11 VARCHAR — change both. A chat line, not a blog. */
    public static final int MAX_BODY_LENGTH = 1000;

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "song_id", nullable = false, updatable = false)
    private Song song;

    // A bare column, not a @ManyToOne User: the entity never needs to
    // NAVIGATE to the author (the name is already here), and a lazy
    // association would be a standing invitation to the N+1 that the
    // denormalization exists to prevent.
    @Column(name = "author_id")
    private UUID authorId;

    @Column(name = "author_name", nullable = false, length = 60)
    private String authorName;

    @Column(nullable = false, length = MAX_BODY_LENGTH)
    private String body;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public ChatMessage(Song song, UUID authorId, String authorName, String body) {
        if (song == null) {
            throw new IllegalArgumentException("Chat message must belong to a song");
        }
        if (authorName == null || authorName.isBlank()) {
            throw new IllegalArgumentException("Chat message must carry its author's name");
        }
        if (body == null || body.isBlank()) {
            throw new IllegalArgumentException("Chat message must not be empty");
        }
        String stripped = body.strip();
        if (stripped.length() > MAX_BODY_LENGTH) {
            throw new IllegalArgumentException(
                    "Chat message must be at most %d characters, got %d".formatted(MAX_BODY_LENGTH, stripped.length()));
        }
        this.song = song;
        this.authorId = authorId;
        this.authorName = authorName.strip();
        this.body = stripped;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof ChatMessage message)) {
            return false;
        }
        return id != null && id.equals(message.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(ChatMessage.class);
    }
}
