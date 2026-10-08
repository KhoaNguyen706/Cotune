package com.cotune.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Deliberately weaker validation than RegisterInput on the PASSWORD.
 * Login must not re-enforce the password POLICY: if we later raise the
 * minimum to 12 chars, users with older 8-char passwords still need to
 * log in. Wrong credentials should fail authentication (UNAUTHORIZED),
 * not input validation (BAD_REQUEST) — the distinction also avoids
 * leaking hints about what a valid password looks like.
 *
 * The EMAIL gets the same shape rules as RegisterInput, because the shape
 * of an email address is no secret: "not-an-email" can never match an
 * account, and saying so per field (errors.email) lets the form point at
 * the input instead of falling through to User.normalizeEmail's generic
 * banner. Same rules as register, never stricter — sign-in must accept
 * every address registration ever accepted.
 */
public record LoginInput(

        @NotBlank
        @Email(message = "email must be a valid address")
        @Size(max = 320)
        String email,

        @NotBlank
        String password
) {
}
