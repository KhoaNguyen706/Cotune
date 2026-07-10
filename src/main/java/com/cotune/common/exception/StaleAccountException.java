package com.cotune.common.exception;

/**
 * A request carried a validly-signed token whose subject no longer exists.
 *
 * How that happens with stateless JWTs: the token is self-contained proof,
 * verified by signature alone — nothing checks the account row per request.
 * If the account is deleted, or the app is repointed at a different
 * database (exactly how this class got written: a local-postgres token
 * used against Supabase), the token stays "valid" while referencing a
 * ghost. Surfaces as UNAUTHORIZED so clients drop the session and
 * re-login, instead of the FK-violation 500 it would otherwise become.
 */
public class StaleAccountException extends RuntimeException {

    public StaleAccountException() {
        super("Your session belongs to an account that no longer exists here - please sign in again");
    }
}
