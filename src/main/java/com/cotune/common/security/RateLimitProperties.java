package com.cotune.common.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Type-safe binding of the cotune.security.rate-limit.* block — same pattern
 * as {@link JwtProperties}: one class documents every knob and a bad value
 * kills the app at startup instead of at the first attack.
 *
 * @param enabled          ops escape hatch; leave true everywhere, flip off
 *                         only if the limiter itself misbehaves in prod.
 * @param authPerMinute    per-IP budget for POST /api/auth/login and
 *                         /api/auth/register — the BCrypt-burning endpoints.
 *                         Sized for a human who fat-fingers a password a few
 *                         times, not for a credential-stuffing script.
 * @param generalPerMinute per-IP budget for everything else. Generous on
 *                         purpose: its job is to blunt accidental runaway
 *                         loops, not to be a WAF.
 */
@ConfigurationProperties(prefix = "cotune.security.rate-limit")
public record RateLimitProperties(boolean enabled, int authPerMinute, int generalPerMinute) {

    public RateLimitProperties {
        if (authPerMinute <= 0 || generalPerMinute <= 0) {
            throw new IllegalArgumentException(
                    "cotune.security.rate-limit budgets must be positive (disable via enabled=false, not zero)");
        }
    }
}
