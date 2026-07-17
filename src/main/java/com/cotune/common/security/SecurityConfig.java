package com.cotune.common.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jose.proc.SecurityContext;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;

/**
 * The security architecture in one paragraph: HTTP-level rules only decide
 * which ENDPOINTS are reachable — and since ALL GraphQL operations arrive
 * as POST /graphql, the URL can't tell a public login apart from a
 * protected deleteSong. So /graphql is permitAll here, and real
 * authorization happens per-operation via @PreAuthorize on the resolver
 * methods (enabled by @EnableMethodSecurity). The bearer-token filter
 * still runs first and, when a JWT is present and valid, populates the
 * SecurityContext that those @PreAuthorize checks read.
 */
@Configuration
@EnableWebSecurity
// Turns on @PreAuthorize/@PostAuthorize processing. Without this the
// annotations on our controllers are silently IGNORED — the single most
// dangerous default in Spring Security, because everything keeps working,
// just unprotected.
@EnableMethodSecurity
@EnableConfigurationProperties({JwtProperties.class, RateLimitProperties.class, AdminProperties.class})
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                // CSRF protection exists because browsers auto-attach COOKIES
                // to cross-site requests. We have no cookies: auth rides in an
                // Authorization header, which browsers never attach on their
                // own — a forged cross-site request arrives unauthenticated
                // and gets rejected anyway. CSRF protection would only break
                // legitimate POSTs to /graphql.
                .csrf(AbstractHttpConfigurer::disable)

                // No HttpSession, ever. Each request must prove identity via
                // its token — that's what lets us later run multiple backend
                // instances without session replication or sticky sessions.
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))

                .authorizeHttpRequests(auth -> auth
                        // REST auth endpoints: the two ways to GET a token
                        // must be reachable without one. Locked to POST —
                        // a GET /api/auth/login has no business existing.
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login").permitAll()
                        // Public listen links: the bytes for a shared song's
                        // audio clips. The URL's token IS the authorization
                        // (verified in ListenService — resolves to a song AND
                        // the audio belongs to it), so like /graphql below the
                        // gate moves off the URL rule. GET only, exact shape
                        // only — nothing else under /api/listen exists.
                        .requestMatchers(HttpMethod.GET, "/api/listen/*/audio/*").permitAll()
                        // Everything else under /api requires a valid token.
                        // Contrast with /graphql below: REST operations are
                        // identified by URL, so URL-level rules work again —
                        // no @PreAuthorize needed on AuthRestController.
                        .requestMatchers("/api/**").authenticated()
                        // Reachable by anyone; per-operation auth via method
                        // security (see class comment).
                        .requestMatchers("/graphql").permitAll()

                        // The WebSocket HANDSHAKE is open, and it has to be:
                        // the browser's WebSocket API cannot send an
                        // Authorization header, so there is no token to check
                        // at this point. Authentication happens one frame
                        // later, on STOMP CONNECT
                        // (see StompAuthChannelInterceptor).
                        //
                        // "Open handshake" is only safe because an open socket
                        // can do NOTHING until it authenticates: SUBSCRIBE and
                        // SEND are both refused for a session with no user. If
                        // you ever add a destination that skips that check,
                        // this permitAll becomes a hole.
                        .requestMatchers("/ws/**").permitAll()
                        // Dev-only IDE. Fine while local; gate or disable it
                        // before any public deployment (application.yml note).
                        .requestMatchers("/graphiql").permitAll()
                        // The SPA shell + its fingerprinted assets (served
                        // from classpath:/static in the Docker image). Only
                        // HTML/JS/CSS — all DATA still rides through
                        // /graphql and /api/** with their own rules above.
                        // "/songs" and "/songs/*" are BOTH here: an Ant pattern
                        // with a trailing /* does not match the bare path, so
                        // the library page needs its own entry or a refresh of
                        // it is a 403 from the deny-by-default rule below.
                        // These serve the HTML SHELL only — being able to fetch
                        // the page is not being able to fetch anybody's songs,
                        // which still goes through /graphql with its own rules.
                        //
                        // "/admin" is permitAll for the same reason and with the
                        // same limit: this serves the HTML shell, nothing more.
                        // An anonymous GET /admin gets the React bundle and then
                        // a login redirect from ProtectedRoute; the invite
                        // mutations behind that page are hasRole('ADMIN')
                        // server-side regardless of who fetched the HTML.
                        // Serving the shell is not serving the data — the same
                        // split as /songs. Without this entry a refresh of
                        // /admin 403s here, before SpaForwardingController runs.
                        .requestMatchers(HttpMethod.GET,
                                "/", "/index.html", "/assets/**", "/favicon.ico",
                                "/login", "/register", "/songs", "/songs/*", "/listen/*",
                                "/admin", "/handbook").permitAll()
                        // Health is public ON PURPOSE: a monitor that must
                        // authenticate is a monitor that silently stops
                        // working when its token expires. Safe because the
                        // prod body is information-free (show-details:
                        // never) — and note this matches /actuator/health
                        // EXACTLY: every other actuator endpoint falls
                        // through to denyAll below, so even a config slip
                        // that widened the exposure list would not open one.
                        .requestMatchers(HttpMethod.GET, "/actuator/health").permitAll()
                        // Boot re-dispatches exceptions to /error internally;
                        // blocking it turns every error into a confusing 403.
                        .requestMatchers("/error").permitAll()
                        // Deny-by-default: an endpoint added next month is
                        // locked until someone consciously opens it. The safe
                        // failure mode is "oops, 403", not "oops, public".
                        .anyRequest().denyAll())

                // Installs BearerTokenAuthenticationFilter: reads the
                // "Authorization: Bearer <jwt>" header, verifies signature +
                // expiry via our JwtDecoder, and puts a JwtAuthenticationToken
                // into the SecurityContext. No header → request proceeds
                // anonymously (permitAll allows that; @PreAuthorize then
                // rejects protected operations). Invalid/expired token → 401
                // before any controller code runs.
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));

        return http.build();
    }

    /**
     * Delegating encoder: hashes as "{bcrypt}$2a$10$..." — the prefix
     * records WHICH algorithm made the hash. When the industry moves on
     * (bcrypt → argon2), old hashes keep verifying while new ones use the
     * new algorithm. Hardcoding new BCryptPasswordEncoder() would make that
     * migration a data-rewrite problem.
     */
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /**
     * Explicitly assembled rather than pulled from auto-config, so the
     * chain is visible: AuthenticationManager → DaoAuthenticationProvider
     * → (CotuneUserDetailsService + PasswordEncoder). This is THE core
     * Spring Security object graph; only the login mutation uses it.
     */
    @Bean
    AuthenticationManager authenticationManager(UserDetailsService userDetailsService,
                                                PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(provider);
    }

    // Encoder and decoder share one symmetric key (HS256): whoever can
    // verify tokens can also mint them. Acceptable while issuer and
    // verifier are the same process. The moment another service must verify
    // our tokens, switch to an asymmetric pair (RS256): they get the public
    // key, only we hold the signing key.
    @Bean
    JwtEncoder jwtEncoder(JwtProperties properties) {
        return new NimbusJwtEncoder(new ImmutableSecret<SecurityContext>(secretKey(properties)));
    }

    @Bean
    JwtDecoder jwtDecoder(JwtProperties properties) {
        // Also validates `exp` (with a small clock-skew tolerance) on every
        // decode — expiry enforcement comes for free.
        return NimbusJwtDecoder.withSecretKey(secretKey(properties))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
    }

    /**
     * Teaches Spring how to turn a decoded JWT into an Authentication.
     * Default behavior reads a "scope" claim and prefixes "SCOPE_" (OAuth2
     * convention); our tokens carry a "roles" claim, and hasRole('ADMIN')
     * expects the "ROLE_" prefix. Skip this converter and every
     * hasRole check fails silently — deny-by-default hides miswiring.
     */
    // A @Bean since session 16, not a private helper: the WebSocket layer
    // authenticates its own CONNECT frames and must build Authentication
    // objects EXACTLY the way the HTTP filter does. A second, hand-rolled
    // converter over there would be a second place for the "roles" claim
    // mapping to drift — and role checks fail silently when it does.
    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authoritiesConverter = new JwtGrantedAuthoritiesConverter();
        authoritiesConverter.setAuthoritiesClaimName("roles");
        authoritiesConverter.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);
        return converter;
    }

    private SecretKey secretKey(JwtProperties properties) {
        byte[] keyBytes = Base64.getDecoder().decode(properties.secret());
        return new SecretKeySpec(keyBytes, "HmacSHA256");
    }
}
