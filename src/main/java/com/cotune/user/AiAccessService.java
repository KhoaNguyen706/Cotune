package com.cotune.user;

import com.cotune.common.exception.ResourceNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The AI invitation list, admin-operated. By EMAIL, same reasoning as
 * shareSong: an admin knows an address, not a UUID, and NOT_FOUND names it
 * so the admin can act on a typo. Both operations are idempotent —
 * granting twice or revoking the never-granted is the requested end state,
 * not an error.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AiAccessService {

    private final UserRepository userRepository;

    public void grant(String email) {
        find(email).grantAiAccess();
    }

    public void revoke(String email) {
        find(email).revokeAiAccess();
    }

    private User find(String email) {
        return userRepository.findByEmail(User.normalizeEmail(email))
                .orElseThrow(() -> ResourceNotFoundException.userByEmail(email));
    }
}
