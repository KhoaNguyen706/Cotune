package com.cotune.common.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Base64;

/**
 * Type-safe binding of the cotune.security.jwt.* block in application.yml.
 * Preferred over sprinkling @Value("${...}") strings around: one class
 * documents every knob, binding fails at STARTUP if config is missing or
 * malformed, and consumers get a plain immutable record to inject.
 *
 * @param secret Base64-encoded HMAC key. HS256 requires >= 256 bits.
 * @param ttl    how long issued tokens live (e.g. "1h" — Boot parses
 *               durations from friendly strings).
 */
@ConfigurationProperties(prefix = "cotune.security.jwt")
public record JwtProperties(String secret, Duration ttl) {

    // Compact constructor = validation at bind time. A weak key or missing
    // TTL kills the app on boot with a clear message, instead of surfacing
    // as cryptic token failures at 2am.
    public JwtProperties {
        if (secret == null || Base64.getDecoder().decode(secret).length < 32) {
            throw new IllegalArgumentException(
                    "cotune.security.jwt.secret must be a Base64-encoded key of at least 32 bytes (256 bits)");
        }
        if (ttl == null || ttl.isNegative() || ttl.isZero()) {
            throw new IllegalArgumentException("cotune.security.jwt.ttl must be a positive duration");
        }
    }
}
