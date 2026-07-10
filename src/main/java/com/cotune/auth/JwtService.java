package com.cotune.auth;

import com.cotune.common.security.JwtProperties;
import com.cotune.user.User;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * Mints the JWTs this server later verifies. A JWT is three Base64 parts:
 * header.claims.signature — the signature (HMAC-SHA256 over the first two
 * parts with our secret key) is what makes the token tamper-proof. Claims
 * are NOT encrypted, only signed: anyone can read them (try the token in
 * jwt.io), so nothing secret ever goes in a claim.
 */
@Component
@RequiredArgsConstructor
public class JwtService {

    private final JwtEncoder jwtEncoder;
    private final JwtProperties properties;

    /** Token + its expiry, so callers can expose expiresAt without re-parsing the JWT. */
    public record IssuedToken(String value, Instant expiresAt) {
    }

    public IssuedToken issueFor(User user) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(properties.ttl());

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("cotune")
                // sub = the user's immutable UUID, NOT the email: users may
                // change their email later, and every already-issued token
                // must keep resolving to the same account.
                .subject(user.getId().toString())
                .issuedAt(now)
                // exp is enforced by JwtDecoder on every request — an expired
                // token is rejected before any controller code runs. Short
                // TTL is the mitigation for JWTs being unrevokable: a stolen
                // token is only useful until it expires.
                .expiresAt(expiresAt)
                // Roles ride inside the token so authorization needs no DB
                // lookup per request. Trade-off: a role change (promotion,
                // demotion!) only takes effect when the user gets a new
                // token — another reason to keep the TTL short.
                .claim("roles", List.of(user.getRole().name()))
                .build();

        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedToken(token, expiresAt);
    }
}
