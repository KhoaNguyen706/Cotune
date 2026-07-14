package com.cotune.user;

import com.cotune.common.security.AdminProperties;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Promotes the configured admin accounts at startup — the half of the
 * admin-emails rule that covers accounts which ALREADY exist (registration
 * covers the ones created later). Runs on every boot and is idempotent, so
 * a restored or brand-new database converges to the configured truth
 * without anyone remembering to run SQL.
 *
 * Deliberately promote-only: removing an email from the list does NOT
 * demote the account. Demotion destroys information (was this admin granted
 * by config or by hand?) and a config typo must not be able to lock every
 * admin out. Demote by ops SQL, deliberately, like the entity comment says.
 */
@Component
@RequiredArgsConstructor
public class AdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final AdminProperties adminProperties;
    private final UserRepository userRepository;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (String email : adminProperties.adminEmails()) {
            userRepository.findByEmail(User.normalizeEmail(email)).ifPresent(user -> {
                if (user.getRole() != Role.ADMIN) {
                    user.promoteToAdmin();
                    log.info("Promoted configured admin account: {}", user.getEmail());
                }
            });
            // Absent account: nothing to do — registration promotes it the
            // moment it's created (AuthServiceImpl).
        }
    }
}
