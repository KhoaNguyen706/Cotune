package com.cotune.ai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The one AI feature worth having (ROADMAP Phase 4): advice about YOUR
 * beat, in the chat where you were already talking about it. Deliberately
 * NOT note generation — this returns words, and words can't corrupt a
 * pattern, so no output needs validating against domain rules.
 *
 * Server-side only: the key lives in an env var, the browser never talks
 * to Google, and the call rides behind the same JWT + canView + chat
 * pipeline as any message. Cost per question is zero-to-negligible
 * (flash's free tier, ~1K tokens in, a few hundred out), bounded further
 * by ChatAiBridge's per-song cooldown.
 */
@Component
public class AiAdvisor {

    private static final Logger log = LoggerFactory.getLogger(AiAdvisor.class);

    /**
     * Fixed and identical on every call — one reviewable constant is the
     * whole behavior contract. The 900-character cap exists because the
     * reply must fit a chat message (1000 chars) — the model is told the
     * real constraint rather than having its answer truncated mid-sentence.
     */
    static final String SYSTEM_PROMPT = """
            You are a friendly, practical music production mentor inside Cotune, \
            a collaborative step-sequencer (16 steps per bar). You will be shown \
            a song's beats as text grids (x = hit, — = held, . = silence) and a \
            question from someone in the room. Give concrete, actionable advice \
            about THIS music: groove, rhythm placement, instrument balance, \
            arrangement, what to try next. Reference lanes and steps by name. \
            Suggest ideas the person can perform themselves — do not output \
            note lists or grids. Stay under 900 characters: two or three short \
            paragraphs at most, no headings, no bullet lists.""";

    private final GeminiClient gemini;

    public AiAdvisor(GeminiClient gemini) {
        this.gemini = gemini;
    }

    public boolean enabled() {
        return gemini.enabled();
    }

    /**
     * One question, one answer, synchronous — the CALLER decides what
     * thread to burn (ChatAiBridge runs this on its own executor so the
     * STOMP thread never waits on Google).
     *
     * @throws AdviceUnavailableException with a human-readable, chat-safe
     *                                    message when the model can't answer
     */
    public String advise(String songContext, String question) {
        if (!enabled()) {
            throw new AdviceUnavailableException(
                    "The AI advisor isn't configured on this server (GEMINI_API_KEY is not set).");
        }
        try {
            return gemini.generateText(SYSTEM_PROMPT,
                    songContext + "\nQuestion from the room: " + question);
        } catch (GeminiClient.RateLimitedException tooFast) {
            throw new AdviceUnavailableException(
                    "The AI advisor is rate-limited right now — try again in a minute.");
        } catch (GeminiClient.UnusableResponseException noAnswer) {
            // A refusal or an empty reply — rare, but "post an empty chat
            // message" must never be the outcome.
            throw new AdviceUnavailableException(
                    "The AI advisor couldn't answer that one — try rephrasing.");
        } catch (GeminiClient.ApiErrorException apiFailure) {
            // Message text stays generic: API error bodies can name models,
            // projects and quota details that don't belong in a shared chat.
            log.warn("AI advice failed: {}", apiFailure.toString());
            throw new AdviceUnavailableException(
                    "The AI advisor hit an error — try again shortly.");
        }
    }

    /** Chat-safe failure: the MESSAGE is the user-facing reply. */
    public static class AdviceUnavailableException extends RuntimeException {
        public AdviceUnavailableException(String chatSafeMessage) {
            super(chatSafeMessage);
        }
    }
}
