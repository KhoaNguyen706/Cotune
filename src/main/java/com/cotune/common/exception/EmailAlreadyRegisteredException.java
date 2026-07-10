package com.cotune.common.exception;

/**
 * Thrown when registration hits an email that already has an account.
 *
 * Security trade-off, made consciously: this message confirms to the caller
 * that the email is registered (account enumeration). For registration this
 * is near-universally accepted — the UX cost of a vague error outweighs the
 * leak, and signup forms reveal it anyway. LOGIN is different: there we
 * never distinguish "no such user" from "wrong password".
 */
public class EmailAlreadyRegisteredException extends RuntimeException {

    public EmailAlreadyRegisteredException(String email) {
        super("An account already exists for email: " + email);
    }
}
