package com.cotune.auth;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.auth.dto.LoginInput;
import com.cotune.auth.dto.RegisterInput;
import com.cotune.user.dto.UserDto;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Auth lives on REST, data lives on GraphQL — a deliberate split:
 *
 * - Auth operations are plain RPC with no graph shape to query; nothing is
 *   lost by leaving GraphQL.
 * - Credentials stay out of GraphQL query strings, which tend to end up in
 *   request logs, persisted-query stores, and APM traces.
 * - Each endpoint has its own URL, so HTTP-native machinery applies again:
 *   SecurityConfig can permit exactly these paths, status codes are real
 *   (401/409 instead of always-200), and a future OAuth redirect flow
 *   slots in beside them naturally.
 *
 * Note what DIDN'T change when auth moved from GraphQL to REST: AuthService
 * is untouched. Controllers are transport adapters; swapping the transport
 * is exactly the change the layering exists to absorb.
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthRestController {

    private final AuthService authService;

    // 201: registration creates a resource (the account). Login below
    // returns plain 200 — it creates nothing, it exchanges credentials
    // for a token.
    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthPayload register(@RequestBody @Valid RegisterInput input) {
        return authService.register(input);
    }

    @PostMapping("/login")
    public AuthPayload login(@RequestBody @Valid LoginInput input) {
        return authService.login(input);
    }

    // No @PreAuthorize needed: SecurityConfig requires authentication for
    // /api/** at the URL level — REST gets to use HTTP-layer rules because,
    // unlike GraphQL, the URL actually identifies the operation.
    @GetMapping("/me")
    public UserDto me(Authentication authentication) {
        // getName() = the JWT's `sub` claim = the user id we minted.
        return authService.me(UUID.fromString(authentication.getName()));
    }
}
