package com.cotune.chat;

import com.cotune.ai.AiAdvisor;
import com.cotune.ai.SongDescriber;
import com.cotune.chat.dto.ChatMessageDto;
import com.cotune.realtime.dto.ChatEvent;
import com.cotune.realtime.relay.RealtimeBroadcaster;
import com.cotune.song.SongAccess;
import com.cotune.user.Role;
import com.cotune.user.UserRepository;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The @ai protocol: any chat line starting with "@ai" is ALSO a question
 * to the advisor, and the advisor's answer arrives as an ordinary chat
 * message from "Cotune AI". That one design choice does most of the work —
 * the reply is persisted, broadcast through the relay, in every
 * collaborator's history, readable by whoever joins tomorrow. No new wire
 * format, no new UI, no per-user duplication of the answer.
 *
 * The AI author is authorId = NULL with a fixed display name — the exact
 * shape a deleted human account already has, so every consumer (frontend
 * colors, history query, relays) handles it because it already had to.
 *
 * Asynchronous by construction: Claude takes seconds, and the caller is a
 * STOMP handler thread that other messages are waiting on. The user's own
 * @ai line echoes back instantly like any message; the answer lands when
 * it lands, exactly like a human collaborator typing.
 */
@Component
public class ChatAiBridge {

    private static final Logger log = LoggerFactory.getLogger(ChatAiBridge.class);
    static final String TRIGGER = "@ai";
    static final String AI_NAME = "Cotune AI";

    /**
     * One question per song per cooldown window. This is the COST gate, not
     * the abuse gate (the per-IP filter is that): a room of four humans all
     * curious at once should produce one bill, not four. In-memory is the
     * same single-instance trade as RateLimitFilter, with the same exit.
     */
    static final long COOLDOWN_MS = 10_000;

    private final AiAdvisor advisor;
    private final SongDescriber songDescriber;
    private final ChatService chatService;
    private final RealtimeBroadcaster broadcaster;
    private final SongAccess songAccess;
    private final UserRepository userRepository;

    // Single thread on purpose: it serializes AI calls (a natural global
    // concurrency cap of 1) and one slow answer queueing behind another is
    // fine for a mentor that answers at most once per song per 10s anyway.
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "chat-ai-advisor");
        thread.setDaemon(true);
        return thread;
    });

    private final Map<UUID, Long> lastAskedAt = new ConcurrentHashMap<>();

    public ChatAiBridge(AiAdvisor advisor, SongDescriber songDescriber,
                        ChatService chatService, RealtimeBroadcaster broadcaster,
                        SongAccess songAccess, UserRepository userRepository) {
        this.advisor = advisor;
        this.songDescriber = songDescriber;
        this.chatService = chatService;
        this.broadcaster = broadcaster;
        this.songAccess = songAccess;
        this.userRepository = userRepository;
    }

    /**
     * Called for every posted chat message, AFTER it has been persisted and
     * broadcast — the human conversation must never wait on, or fail with,
     * the AI machinery.
     */
    public void maybeHandle(UUID songId, ChatMessageDto message) {
        String body = message.body();
        if (!body.toLowerCase(Locale.ROOT).startsWith(TRIGGER)) {
            return;
        }
        String question = body.substring(TRIGGER.length()).strip();
        if (question.isEmpty()) {
            question = "How can this beat be improved?"; // a bare @ai is that question
        }

        // Gate 1 — on the song at all: owner or invited collaborator.
        // Chat's canView already implies this; the check is deliberate
        // redundancy so "who may spend AI tokens" holds on its own the day
        // chat's own rules loosen. rolesFor answers with ABSENCE for a
        // stranger, so empty = not a member.
        UUID asker = message.authorId();
        if (asker == null || songAccess.rolesFor(asker, List.of(songId)).isEmpty()) {
            reply(songId, "Only people invited to this song can ask the AI.");
            return;
        }

        // Gate 2 — invited to the AI itself, BY AN ADMIN (V13): being in a
        // song's chat and being allowed to spend the app's Anthropic tokens
        // are different powers, and the second is a per-account grant
        // (grantAiAccess), not a side effect of the first. Admins are
        // always in — the people who hold the invitation list don't need
        // an entry on it.
        boolean invited = userRepository.findById(asker)
                .map(user -> user.getRole() == Role.ADMIN || user.isAiAccess())
                .orElse(false);
        if (!invited) {
            reply(songId, "The AI is invite-only — ask an admin to enable it for your account.");
            return;
        }

        long now = System.currentTimeMillis();
        Long previous = lastAskedAt.get(songId);
        if (previous != null && now - previous < COOLDOWN_MS) {
            // Deliberately does NOT reset the window: if refused asks
            // extended it, impatient re-asking would lock @ai out forever.
            reply(songId, "One question at a time — ask me again in a few seconds.");
            return;
        }
        lastAskedAt.put(songId, now);

        final String finalQuestion = question;
        executor.submit(() -> answer(songId, finalQuestion));
    }

    private void answer(UUID songId, String question) {
        try {
            String advice = advisor.advise(songDescriber.describe(songId), question);
            reply(songId, advice);
        } catch (AiAdvisor.AdviceUnavailableException unavailable) {
            // The exception message is written to be said in chat.
            reply(songId, unavailable.getMessage());
        } catch (Exception unexpected) {
            // An async failure with no reply would be @ai silently eating
            // questions — worse than any error text.
            log.error("AI advice pipeline failed for song {}", songId, unexpected);
            reply(songId, "The AI advisor hit an unexpected error — try again shortly.");
        }
    }

    private void reply(UUID songId, String text) {
        // The model is ASKED to stay under 900 chars but nothing guarantees
        // it; ChatMessage enforces its 1000-char cap by throwing. Losing a
        // sentence beats losing the whole answer to an error message.
        if (text.length() > ChatMessage.MAX_BODY_LENGTH) {
            text = text.substring(0, ChatMessage.MAX_BODY_LENGTH - 1) + "…";
        }
        ChatMessageDto saved = chatService.post(songId, null, AI_NAME, text);
        broadcaster.broadcast("/topic/songs/" + songId + "/chat", ChatEvent.of(saved));
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow(); // in-flight advice may die with the process; it's advice
    }
}
