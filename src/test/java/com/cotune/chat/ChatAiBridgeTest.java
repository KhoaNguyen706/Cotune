package com.cotune.chat;

import com.cotune.ai.AiAdvisor;
import com.cotune.ai.SongDescriber;
import com.cotune.chat.dto.ChatMessageDto;
import com.cotune.realtime.relay.RealtimeBroadcaster;
import com.cotune.song.SongAccess;
import com.cotune.song.SongRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.anyCollection;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The membership gate, pinned at the unit level ON PURPOSE: through the
 * real STOMP pipeline a non-member can't even reach the chat handler
 * (canView refuses them first), so the integration suite structurally
 * CANNOT exercise this branch. That's exactly why the gate exists — it
 * must hold on its own the day chat's own rules loosen — and a unit test
 * is the only place it can be seen working.
 */
@ExtendWith(MockitoExtension.class)
class ChatAiBridgeTest {

    @Mock
    private AiAdvisor advisor;
    @Mock
    private SongDescriber songDescriber;
    @Mock
    private ChatService chatService;
    @Mock
    private RealtimeBroadcaster broadcaster;
    @Mock
    private SongAccess songAccess;
    @InjectMocks
    private ChatAiBridge bridge;

    private final UUID songId = UUID.randomUUID();
    private final UUID memberId = UUID.randomUUID();

    private ChatMessageDto message(UUID authorId, String body) {
        return new ChatMessageDto(UUID.randomUUID(), songId, authorId, "Someone", body,
                OffsetDateTime.now());
    }

    private void stubReplyPersistence() {
        when(chatService.post(eq(songId), isNull(), eq(ChatAiBridge.AI_NAME), anyString()))
                .thenAnswer(invocation -> message(null, invocation.getArgument(3)));
    }

    @Test
    void aMessageWithoutTheTriggerNeverTouchesTheAiMachinery() {
        bridge.maybeHandle(songId, message(memberId, "sounds great, ship it"));

        verifyNoInteractions(advisor, songDescriber, chatService, broadcaster, songAccess);
    }

    @Test
    void aNonMemberIsRefusedAndTheAdvisorNeverRuns() {
        // rolesFor answers with ABSENCE for a stranger — no role, no entry.
        when(songAccess.rolesFor(any(), anyCollection())).thenReturn(Map.of());
        stubReplyPersistence();

        bridge.maybeHandle(songId, message(UUID.randomUUID(), "@ai make it slap"));

        verify(chatService).post(eq(songId), isNull(), eq(ChatAiBridge.AI_NAME),
                contains("invited"));
        verifyNoInteractions(advisor, songDescriber);
    }

    @Test
    void anAuthorlessMessageIsRefusedWithoutEvenALookup() {
        // authorId null = a deleted account's history shape; nothing current
        // should produce it live, but the gate must not NPE or wave it in.
        stubReplyPersistence();

        bridge.maybeHandle(songId, message(null, "@ai hello"));

        verify(chatService).post(eq(songId), isNull(), eq(ChatAiBridge.AI_NAME),
                contains("invited"));
        verifyNoInteractions(advisor, songDescriber, songAccess);
    }

    @Test
    void aMemberInAnyRoleGetsThroughToTheAdvisor() {
        when(songAccess.rolesFor(eq(memberId), anyCollection()))
                .thenReturn(Map.of(songId, SongRole.VIEWER)); // the WEAKEST role suffices
        when(songDescriber.describe(songId)).thenReturn("Song \"X\" — 120 BPM");
        when(advisor.advise(anyString(), anyString())).thenReturn("Try ghost notes.");
        stubReplyPersistence();

        bridge.maybeHandle(songId, message(memberId, "@ai how do I add groove?"));

        // The answer path is asynchronous (single-thread executor), so the
        // verification polls: mockito's timeout() is the async-safe verify.
        verify(advisor, timeout(2000)).advise(anyString(), eq("how do I add groove?"));
        verify(chatService, timeout(2000)).post(eq(songId), isNull(), eq(ChatAiBridge.AI_NAME),
                eq("Try ghost notes."));
    }
}
