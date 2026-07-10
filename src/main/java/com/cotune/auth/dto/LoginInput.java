package com.cotune.auth.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Only @NotBlank — deliberately weaker validation than RegisterInput.
 * Login must not re-enforce the password POLICY: if we later raise the
 * minimum to 12 chars, users with older 8-char passwords still need to
 * log in. Wrong credentials should fail authentication (UNAUTHORIZED),
 * not input validation (BAD_REQUEST) — the distinction also avoids
 * leaking hints about what a valid password looks like.
 */
public record LoginInput(

        @NotBlank
        String email,

        @NotBlank
        String password
) {
}
