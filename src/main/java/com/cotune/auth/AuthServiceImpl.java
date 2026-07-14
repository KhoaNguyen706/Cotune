package com.cotune.auth;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.auth.dto.LoginInput;
import com.cotune.auth.dto.RegisterInput;
import com.cotune.common.exception.EmailAlreadyRegisteredException;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.mapping.Timestamps;
import com.cotune.common.security.AdminProperties;
import com.cotune.user.User;
import com.cotune.user.UserMapper;
import com.cotune.user.UserRepository;
import com.cotune.user.dto.UserDto;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;
    private final UserMapper userMapper;
    private final AdminProperties adminProperties;

    @Override
    public AuthPayload register(RegisterInput input) {
        String email = User.normalizeEmail(input.email());

        // Friendly-path check. It races (two concurrent registrations can
        // both pass it), so the REAL guarantee is the unique index on
        // LOWER(email) — the loser of the race gets a constraint violation
        // at commit. Check-then-act across a network is never atomic;
        // uniqueness must be enforced where the data lives.
        if (userRepository.existsByEmail(email)) {
            throw new EmailAlreadyRegisteredException(email);
        }

        // encode() salts and hashes (bcrypt). Salting is why two users with
        // the same password get different hashes — and why we could never
        // "look up the hash" instead of calling matches() at login.
        User user = new User(email, passwordEncoder.encode(input.password()), input.displayName());
        // The other half of the admin-emails rule (AdminBootstrap covers
        // accounts that already exist at startup): a configured admin who
        // registers AFTER boot is an admin from their first request. Safe
        // against mass-assignment because the list is server config, not
        // anything the payload can influence.
        if (adminProperties.isAdminEmail(email)) {
            user.promoteToAdmin();
        }
        // saveAndFlush, not save: @CreationTimestamp is populated when the
        // INSERT actually runs, which plain save() defers to transaction
        // commit — AFTER the DTO below is built, so the response would
        // carry createdAt: null. Same timing trap SongServiceImpl.update
        // documents; found live during verification of this session.
        User saved = userRepository.saveAndFlush(user);

        // Registration doubles as first login — issuing a token here saves
        // the client an immediate second round-trip.
        return toPayload(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public AuthPayload login(LoginInput input) {
        // Delegate credential checking to Spring's AuthenticationManager
        // instead of hand-comparing hashes. What runs under the hood:
        // DaoAuthenticationProvider → CotuneUserDetailsService (load by
        // email) → PasswordEncoder.matches(raw, hash). Wrong password OR
        // unknown email both surface as BadCredentialsException — one
        // indistinguishable failure, on purpose (no account enumeration).
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(User.normalizeEmail(input.email()), input.password()));

        // The principal is the AuthenticatedUser our UserDetailsService
        // built, still carrying the domain User — no second DB query.
        AuthenticatedUser principal = (AuthenticatedUser) authentication.getPrincipal();
        return toPayload(principal.getUser());
    }

    @Override
    @Transactional(readOnly = true)
    public UserDto me(UUID userId) {
        // A valid, unexpired token for a since-deleted account is possible
        // (JWTs are not revoked) — treat it as not-found, not a server error.
        User user = userRepository.findById(userId)
                .orElseThrow(() -> ResourceNotFoundException.user(userId));
        return userMapper.toDto(user);
    }

    private AuthPayload toPayload(User user) {
        JwtService.IssuedToken token = jwtService.issueFor(user);
        return new AuthPayload(token.value(), Timestamps.utc(token.expiresAt()), userMapper.toDto(user));
    }
}
