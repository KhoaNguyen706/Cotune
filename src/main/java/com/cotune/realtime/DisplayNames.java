package com.cotune.realtime;

import com.cotune.user.User;
import com.cotune.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * "Who is this token, in words a human can read" — extracted from
 * RealtimeController the day chat became its second consumer.
 *
 * The signed token carries the display name (session 17), so labelling a
 * cursor or a chat line costs zero queries — which matters, because cursor
 * messages arrive many times a second and a database hit per message would
 * make moving the mouse a load test.
 *
 * Tokens minted before that claim existed fall back to one lookup, memoised
 * for the life of the process. Bounded by the number of accounts holding a
 * stale token; empties itself on restart.
 */
@Component
@RequiredArgsConstructor
public class DisplayNames {

    private final UserRepository userRepository;

    private final Map<UUID, String> legacyNames = new ConcurrentHashMap<>();

    public String of(Authentication authentication) {
        if (authentication.getPrincipal() instanceof Jwt jwt) {
            String name = jwt.getClaimAsString("name");
            if (name != null && !name.isBlank()) {
                return name;
            }
        }
        UUID userId = UUID.fromString(authentication.getName());
        return legacyNames.computeIfAbsent(userId, id -> userRepository.findById(id)
                .map(User::getDisplayName)
                .orElse("Collaborator"));
    }
}
