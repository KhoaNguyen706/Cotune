package com.cotune.auth;

import com.cotune.user.User;
import com.cotune.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The bridge Spring Security calls during password login: "give me the
 * stored credentials for this username". Only the login flow uses it —
 * every subsequent request authenticates via JWT, which never touches
 * the database (that's the entire point of stateless tokens).
 *
 * Side effect of defining this bean: Spring Boot stops auto-configuring
 * its default in-memory user (the generated password in the startup log).
 */
@Service
@RequiredArgsConstructor
public class CotuneUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        return userRepository.findByEmail(User.normalizeEmail(email))
                .map(AuthenticatedUser::new)
                // Don't worry about this message leaking "user exists" info:
                // DaoAuthenticationProvider deliberately swallows
                // UsernameNotFoundException and reports it as the same
                // BadCredentialsException a wrong password produces, so an
                // attacker can't probe which emails are registered.
                .orElseThrow(() -> new UsernameNotFoundException("No user with email " + email));
    }
}
