package com.cotune.ai;

import com.cotune.track.dto.StepDto;
import com.cotune.user.Role;
import com.cotune.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The generation mutation, and every gate in front of it. The gates
 * deliberately mirror ChatAiBridge — same question ("who may spend the
 * app's Anthropic tokens?"), same answer, and canEdit on top because
 * unlike advice, generated notes are headed for the song:
 *
 *   1. canEdit on the track (@trackAccess — VIEWERs and strangers out)
 *   2. AI invite list (V13: aiAccess granted by an ADMIN; admins always in)
 *   3. per-user cooldown (the COST gate — the per-IP filter is the abuse gate)
 */
@Controller
@RequiredArgsConstructor
@PreAuthorize("isAuthenticated()")
public class PatternGraphqlController {

    /** One generation per user per window — chat's per-song 10s, re-keyed:
     *  generation is a per-person button, not a shared room resource. */
    static final long COOLDOWN_MS = 10_000;

    /** Enough for "a rolling boom-bap kick with ghost hits before the snares";
     *  not enough to smuggle an essay into the model's context. */
    static final int MAX_PROMPT_LENGTH = 300;

    private final PatternGenerator generator;
    private final SongDescriber songDescriber;
    private final UserRepository userRepository;

    // In-memory: same single-instance trade as ChatAiBridge and
    // RateLimitFilter, with the same exit (move to Redis when web > 1).
    private final Map<UUID, Long> lastGeneratedAt = new ConcurrentHashMap<>();

    @MutationMapping
    @PreAuthorize("isAuthenticated() and @trackAccess.canEdit(#trackId, authentication)")
    public List<StepDto> generateTrackPattern(@Argument UUID trackId,
                                              @Argument String prompt,
                                              Authentication authentication) {
        if (prompt == null || prompt.isBlank()) {
            throw new IllegalArgumentException("Describe the pattern you want — the prompt is empty.");
        }
        if (prompt.length() > MAX_PROMPT_LENGTH) {
            throw new IllegalArgumentException(
                    "Keep the prompt under %d characters.".formatted(MAX_PROMPT_LENGTH));
        }

        // Same invite-list rule as ChatAiBridge, same wording. AccessDenied
        // (not a custom exception) so Spring GraphQL classifies it FORBIDDEN
        // like every other authorization failure in the API.
        UUID caller = UUID.fromString(authentication.getName());
        boolean invited = userRepository.findById(caller)
                .map(user -> user.getRole() == Role.ADMIN || user.isAiAccess())
                .orElse(false);
        if (!invited) {
            throw new AccessDeniedException(
                    "The AI is invite-only — ask an admin to enable it for your account.");
        }

        long now = System.currentTimeMillis();
        Long previous = lastGeneratedAt.get(caller);
        if (previous != null && now - previous < COOLDOWN_MS) {
            // Does NOT reset the window — see ChatAiBridge for why.
            throw new PatternGenerator.GenerationUnavailableException(
                    "One generation at a time — try again in a few seconds.");
        }
        lastGeneratedAt.put(caller, now);

        // Two proxied transactional reads, then the slow API call happens
        // with no DB connection held — see PatternGenerator.laneContext.
        PatternGenerator.LaneContext lane = generator.laneContext(trackId);
        String songContext = songDescriber.describe(lane.songId());
        return generator.generate(songContext, lane, prompt).stream()
                .map(note -> new StepDto(note.step(), note.pitch(), note.velocity(), note.length()))
                .toList();
    }
}
