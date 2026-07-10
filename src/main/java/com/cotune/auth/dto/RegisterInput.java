package com.cotune.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterInput(

        @NotBlank
        @Email(message = "email must be a valid address")
        @Size(max = 320)
        String email,

        // max 72 is not arbitrary: bcrypt silently truncates input beyond
        // 72 BYTES, so "correct-horse...(100 chars)" and its 72-char prefix
        // would hash identically. Rejecting longer passwords is more honest
        // than silently weakening them.
        @NotBlank
        @Size(min = 8, max = 72, message = "password must be 8-72 characters")
        String password,

        @NotBlank
        @Size(max = 60)
        String displayName
) {
}
