package com.cotune.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * An account. Same rich-domain rules as Song: guarded constructor,
 * intention-revealing mutators, identity-based equals/hashCode,
 * no @Setter/@Data (see Song.java for the full rationale).
 *
 * Two security-shaped decisions live in this class:
 *
 * 1. The entity stores a password HASH and has no idea how to hash.
 *    Hashing needs a PasswordEncoder — a Spring bean — and entities must
 *    stay framework-free so they are testable and reusable anywhere.
 *    The service layer encodes; the entity only refuses blank hashes.
 *
 * 2. The entity does NOT implement Spring Security's UserDetails.
 *    That would couple the domain model to the security framework's
 *    vocabulary. AuthenticatedUser (in com.cotune.auth) adapts this
 *    entity to UserDetails — this is the adapter pattern.
 */
@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 320)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 100)
    private String passwordHash;

    @Column(name = "display_name", nullable = false, length = 60)
    private String displayName;

    // STRING, never ORDINAL: ordinal stores the enum's position (0, 1, ...),
    // so inserting a new constant in the middle silently reassigns every
    // user's role. Classic data-corruption footgun.
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Role role;

    // May this account use the AI features (V13)? FALSE until an ADMIN
    // grants it — a per-person invitation, deliberately not derivable from
    // role or song membership. Primitive boolean: the column is NOT NULL,
    // so a nullable Boolean would only add a third state that can't exist.
    @Column(name = "ai_access", nullable = false)
    private boolean aiAccess;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public User(String email, String passwordHash, String displayName) {
        changeEmail(email);
        changePasswordHash(passwordHash);
        rename(displayName);
        // Role is assigned server-side, never accepted from client input.
        // If RegisterInput carried a role field, anyone could POST
        // role: ADMIN — a mass-assignment vulnerability. Promotion to ADMIN
        // is a deliberate act (ops SQL today, an admin mutation later).
        this.role = Role.USER;
    }

    public void changeEmail(String newEmail) {
        this.email = normalizeEmail(newEmail);
    }

    public void changePasswordHash(String newPasswordHash) {
        if (newPasswordHash == null || newPasswordHash.isBlank()) {
            throw new IllegalArgumentException("Password hash must not be blank");
        }
        this.passwordHash = newPasswordHash;
    }

    public void rename(String newDisplayName) {
        if (newDisplayName == null || newDisplayName.isBlank()) {
            throw new IllegalArgumentException("Display name must not be blank");
        }
        this.displayName = newDisplayName.strip();
    }

    /**
     * The deliberate act the constructor's comment promised: promotion is
     * never client input, it happens through AdminBootstrap (configured
     * emails) or ops SQL. Idempotent — promoting an admin is a no-op.
     */
    public void promoteToAdmin() {
        this.role = Role.ADMIN;
    }

    /** Admin-granted permission to use AI features. See ChatAiBridge. */
    public void grantAiAccess() {
        this.aiAccess = true;
    }

    public void revokeAiAccess() {
        this.aiAccess = false;
    }

    /**
     * One canonical form for emails, used by BOTH writes (constructor) and
     * reads (login lookup). If normalization lived only on the write path,
     * a user who registered as "Bob@x.com" could never log in as
     * "bob@x.com" — same rule, one place, both directions.
     */
    public static String normalizeEmail(String raw) {
        if (raw == null || !raw.contains("@")) {
            throw new IllegalArgumentException("Not a valid email address");
        }
        // Locale.ROOT: default-locale lowercasing is environment-dependent
        // (the famous Turkish dotless-ı turns "I" into "ı", not "i").
        return raw.strip().toLowerCase(Locale.ROOT);
    }

    // Identity-based equality — same contract and same reasoning as
    // Song.equals/hashCode (see Song.java).
    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof User user)) {
            return false;
        }
        return id != null && id.equals(user.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(User.class);
    }
}
