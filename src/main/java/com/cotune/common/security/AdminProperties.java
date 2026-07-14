package com.cotune.common.security;

import com.cotune.user.User;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * cotune.security.admin-emails — the accounts that are ALWAYS admins.
 *
 * Why config instead of only ops SQL: SQL grants exist per database and
 * silently vanish with it (a reset dev DB, a fresh environment, a restore).
 * A configured list is applied by AdminBootstrap at startup and by
 * registration when the account is created later — so "who runs this app"
 * survives every database the app ever meets. Spring binds the env var's
 * comma-separated string to the list.
 */
@ConfigurationProperties(prefix = "cotune.security")
public record AdminProperties(List<String> adminEmails) {

    public AdminProperties {
        adminEmails = adminEmails == null ? List.of() : adminEmails;
    }

    /** Compares in the same canonical form registration stores. */
    public boolean isAdminEmail(String email) {
        String normalized = User.normalizeEmail(email);
        return adminEmails.stream()
                .anyMatch(configured -> User.normalizeEmail(configured).equals(normalized));
    }
}
