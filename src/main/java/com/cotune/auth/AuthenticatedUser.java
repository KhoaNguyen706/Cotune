package com.cotune.auth;

import com.cotune.user.User;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

/**
 * Adapter (that's the pattern, literally): presents our domain User in the
 * shape Spring Security's authentication machinery expects (UserDetails),
 * so the domain entity never has to know the framework exists.
 *
 * It also keeps a reference to the underlying User: after a successful
 * login, AuthServiceImpl pulls the domain object back out of the principal
 * instead of re-querying the database by email.
 */
@RequiredArgsConstructor
public class AuthenticatedUser implements UserDetails {

    @Getter
    private final User user;

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        // "ROLE_" prefix is Spring Security's convention: hasRole('ADMIN')
        // expands to a check for the authority "ROLE_ADMIN". Forgetting the
        // prefix here is the classic "my @PreAuthorize never passes" bug.
        return List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()));
    }

    @Override
    public String getPassword() {
        // The HASH — DaoAuthenticationProvider compares it against the
        // submitted raw password via PasswordEncoder.matches().
        return user.getPasswordHash();
    }

    @Override
    public String getUsername() {
        // "Username" is Spring's word for "whatever uniquely identifies the
        // account at login" — for us that's the email.
        return user.getEmail();
    }

    // The remaining UserDetails methods (isAccountNonExpired, isEnabled, ...)
    // default to true in the interface — fine until we add account
    // suspension, at which point they map to real columns.
}
