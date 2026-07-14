package com.cotune.chat;

import com.cotune.chat.dto.ChatMessageDto;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
@RequiredArgsConstructor
public class ChatServiceImpl implements ChatService {

    /**
     * How much history a chat opens with. Enough that "scroll up a bit"
     * answers most questions; small enough that opening a busy song does
     * not ship a novella. Older history stays in the table — a "load more"
     * is a Pageable away when someone actually asks for it.
     */
    static final int RECENT_LIMIT = 50;

    private final ChatMessageRepository chatMessageRepository;
    private final SongRepository songRepository;
    private final ChatMapper chatMapper;

    @Override
    public ChatMessageDto post(UUID songId, UUID authorId, String authorName, String body) {
        // Existence check for a clean NOT_FOUND, lazy reference for the FK —
        // the same idiom as every child-creation service (see BeatServiceImpl).
        if (!songRepository.existsById(songId)) {
            throw ResourceNotFoundException.song(songId);
        }
        Song songRef = songRepository.getReferenceById(songId);

        ChatMessage saved = chatMessageRepository.save(
                new ChatMessage(songRef, authorId, authorName, body));
        return chatMapper.toDto(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ChatMessageDto> recent(UUID songId) {
        if (!songRepository.existsById(songId)) {
            throw ResourceNotFoundException.song(songId);
        }
        // Fetched newest-first (that's the indexed direction and the page
        // that matters); reversed so the client renders top-to-bottom
        // without re-sorting timestamps it shouldn't have to parse.
        List<ChatMessageDto> newestFirst = chatMessageRepository
                .findRecent(songId, PageRequest.of(0, RECENT_LIMIT))
                .stream()
                .map(chatMapper::toDto)
                .toList();
        return newestFirst.reversed();
    }
}
