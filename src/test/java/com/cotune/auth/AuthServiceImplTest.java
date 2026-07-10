package com.cotune.auth;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.auth.dto.LoginInput;
import com.cotune.auth.dto.RegisterInput;
import com.cotune.common.exception.EmailAlreadyRegisteredException;
import com.cotune.common.security.JwtProperties;
import com.cotune.user.Role;
import com.cotune.user.User;
import com.cotune.user.UserMapper;
import com.cotune.user.UserRepository;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jose.proc.SecurityContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import javax.crypto.spec.SecretKeySpec;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Same philosophy as TrackServiceImplTest: mock the I/O edges (repository,
 * AuthenticationManager), keep pure collaborators REAL. PasswordEncoder and
 * JwtService are deterministic CPU-bound code — mocking them would only
 * verify that we called our own mocks. Using the real ones lets the test
 * assert the properties that matter: the stored hash verifies against the
 * raw password, and the issued token is a well-formed JWT.
 */
@ExtendWith(MockitoExtension.class)
class AuthServiceImplTest {

    // Any >= 32-byte Base64 key works for tests; unrelated to the real secret.
    private static final String TEST_SECRET =
            Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes());

    @Mock
    private UserRepository userRepository;

    @Mock
    private AuthenticationManager authenticationManager;

    private final PasswordEncoder passwordEncoder =
            PasswordEncoderFactories.createDelegatingPasswordEncoder();

    private AuthServiceImpl service;

    @BeforeEach
    void setUp() {
        JwtProperties properties = new JwtProperties(TEST_SECRET, Duration.ofHours(1));
        JwtService jwtService = new JwtService(
                new NimbusJwtEncoder(new ImmutableSecret<SecurityContext>(
                        new SecretKeySpec(Base64.getDecoder().decode(TEST_SECRET), "HmacSHA256"))),
                properties);
        service = new AuthServiceImpl(
                userRepository, passwordEncoder, authenticationManager, jwtService, new UserMapper());
    }

    @Test
    void registerStoresHashNotPlaintextAndDefaultsRoleToUser() {
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(inv -> saveWithGeneratedId(inv.getArgument(0)));

        AuthPayload payload = service.register(
                new RegisterInput("alice@example.com", "correct-horse-battery", "Alice"));

        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(userRepository).saveAndFlush(saved.capture());

        // The core promise of this session: the raw password never reaches
        // the database, but the stored hash still verifies against it.
        assertThat(saved.getValue().getPasswordHash()).isNotEqualTo("correct-horse-battery");
        assertThat(passwordEncoder.matches("correct-horse-battery", saved.getValue().getPasswordHash()))
                .isTrue();

        assertThat(payload.user().role()).isEqualTo(Role.USER);
        // Structural JWT check: header.claims.signature.
        assertThat(payload.token()).contains(".").matches("[^.]+\\.[^.]+\\.[^.]+");
    }

    @Test
    void registerNormalizesEmailBeforeUniquenessCheckAndSave() {
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(inv -> saveWithGeneratedId(inv.getArgument(0)));

        AuthPayload payload = service.register(
                new RegisterInput("  Alice@Example.COM ", "correct-horse-battery", "Alice"));

        // Registered with a shouty email, stored canonical — otherwise the
        // login lookup (which normalizes) would never find this row.
        assertThat(payload.user().email()).isEqualTo("alice@example.com");
    }

    @Test
    void registerRejectsDuplicateEmailWithoutSaving() {
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(true);

        assertThatThrownBy(() -> service.register(
                new RegisterInput("alice@example.com", "correct-horse-battery", "Alice")))
                .isInstanceOf(EmailAlreadyRegisteredException.class);

        verify(userRepository, never()).saveAndFlush(any());
    }

    @Test
    void loginReturnsTokenForTheAuthenticatedPrincipal() {
        User user = userWithId("alice@example.com");
        // Simulate what the real AuthenticationManager returns on success:
        // an authenticated token whose principal is OUR UserDetails adapter.
        AuthenticatedUser principal = new AuthenticatedUser(user);
        when(authenticationManager.authenticate(any()))
                .thenReturn(UsernamePasswordAuthenticationToken.authenticated(
                        principal, null, principal.getAuthorities()));

        AuthPayload payload = service.login(new LoginInput("alice@example.com", "correct-horse-battery"));

        assertThat(payload.user().id()).isEqualTo(user.getId());
        assertThat(payload.token()).isNotBlank();
        assertThat(payload.expiresAt()).isNotNull();
    }

    @Test
    void loginPropagatesBadCredentials() {
        when(authenticationManager.authenticate(any()))
                .thenThrow(new BadCredentialsException("Bad credentials"));

        // The service does NOT catch this: it belongs to the central
        // GraphqlExceptionResolver, which maps it to UNAUTHORIZED with a
        // deliberately vague message.
        assertThatThrownBy(() -> service.login(new LoginInput("alice@example.com", "wrong")))
                .isInstanceOf(BadCredentialsException.class);
    }

    /**
     * The id is normally assigned by Hibernate at persist time
     * (GenerationType.UUID); with a mocked repository nobody does that, and
     * JwtService needs the id for the token's subject. Setting it via
     * reflection mimics exactly what the persistence layer would do.
     */
    private User saveWithGeneratedId(User user) {
        ReflectionTestUtils.setField(user, "id", UUID.randomUUID());
        return user;
    }

    private User userWithId(String email) {
        User user = new User(email, passwordEncoder.encode("correct-horse-battery"), "Alice");
        return saveWithGeneratedId(user);
    }
}
