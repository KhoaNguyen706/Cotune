package com.cotune.ai;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;

import java.util.stream.Collectors;

/**
 * The one AI feature worth having (ROADMAP Phase 4): advice about YOUR
 * beat, in the chat where you were already talking about it. Deliberately
 * NOT note generation — this returns words, and words can't corrupt a
 * pattern, so no output needs validating against domain rules.
 *
 * Server-side only: the key lives in an env var, the browser never talks
 * to Anthropic, and the call rides behind the same JWT + canView + chat
 * pipeline as any message. Cost per question is a fraction of a cent
 * (~1K tokens in, a few hundred out), bounded further by ChatAiBridge's
 * per-song cooldown.
 */
@Component
public class AiAdvisor {

    private static final Logger log = LoggerFactory.getLogger(AiAdvisor.class);

    /**
     * Fixed and identical on every call — Anthropic caches prompts by
     * prefix, so a byte-stable system prompt is the cheap half of the
     * request. The 900-character cap exists because the reply must fit a
     * chat message (1000 chars) — the model is told the real constraint
     * rather than having its answer truncated mid-sentence.
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

    private final AiProperties properties;
    // Built once and reused (it holds a connection pool); null when the
    // feature is off — enabled() guards every use.
    private final AnthropicClient client;

    public AiAdvisor(AiProperties properties) {
        this.properties = properties;
        this.client = properties.enabled()
                ? AnthropicOkHttpClient.builder().apiKey(properties.apiKey()).build()
                : null;
    }

    public boolean enabled() {
        return properties.enabled();
    }

    /**
     * One question, one answer, synchronous — the CALLER decides what
     * thread to burn (ChatAiBridge runs this on its own executor so the
     * STOMP thread never waits on Anthropic).
     *
     * @throws AdviceUnavailableException with a human-readable, chat-safe
     *                                    message when the model can't answer
     */
    public String advise(String songContext, String question) {
        if (!enabled()) {
            throw new AdviceUnavailableException(
                    "The AI advisor isn't configured on this server (ANTHROPIC_API_KEY is not set).");
        }
        try {
            // Deliberately NO thinking and NO effort parameter: the model id
            // is configuration (ANTHROPIC_MODEL), and this plain shape is the
            // one every current Anthropic model accepts — Haiku 4.5 rejects
            // adaptive thinking and effort outright (400), while on Opus-tier
            // models omitting them just means "answer directly", which is
            // exactly right for latency-sensitive chat advice.
            Message response = client.messages().create(MessageCreateParams.builder()
                    .model(properties.model())
                    .maxTokens(4096L)
                    .system(SYSTEM_PROMPT)
                    .addUserMessage(songContext + "\nQuestion from the room: " + question)
                    .build());

            String advice = response.content().stream()
                    .flatMap(block -> block.text().stream())
                    .map(text -> text.text())
                    .collect(Collectors.joining("\n"))
                    .strip();
            if (advice.isEmpty()) {
                // stop_reason `refusal` or an all-thinking response — rare,
                // but "post an empty chat message" must never be the outcome.
                throw new AdviceUnavailableException(
                        "The AI advisor couldn't answer that one — try rephrasing.");
            }
            return advice;
        } catch (RateLimitException tooFast) {
            throw new AdviceUnavailableException(
                    "The AI advisor is rate-limited right now — try again in a minute.");
        } catch (AnthropicServiceException apiFailure) {
            // Message text stays generic: API error bodies can name models,
            // orgs and quota details that don't belong in a shared chat.
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

    /** Registers the properties record — mirrors SecurityConfig's pattern. */
    @Configuration
    @EnableConfigurationProperties(AiProperties.class)
    static class AiConfig {
    }
}
