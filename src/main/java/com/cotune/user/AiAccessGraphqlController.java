package com.cotune.user;

import jakarta.validation.constraints.Email;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

/**
 * The first ROLE-gated (not object-gated) mutations since deleteSong lost
 * its ADMIN check: "who may use AI" is app administration, not something
 * any song's owner decides. hasRole('ADMIN') reads the ROLE_ADMIN
 * authority the JWT converter builds from the token's roles claim — which
 * is minted at LOGIN, so a freshly promoted admin signs in again before
 * these work for them.
 */
@Controller
@Validated
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AiAccessGraphqlController {

    private final AiAccessService aiAccessService;

    @MutationMapping
    public boolean grantAiAccess(@Argument @Email String email) {
        aiAccessService.grant(email);
        return true;
    }

    @MutationMapping
    public boolean revokeAiAccess(@Argument @Email String email) {
        aiAccessService.revoke(email);
        return true;
    }
}
