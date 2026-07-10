package com.cotune.common.web;

import com.cotune.common.exception.EmailAlreadyRegisteredException;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.exception.StaleVersionException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The REST twin of GraphqlExceptionResolver: one central place mapping
 * domain exceptions to HTTP responses. GraphQL exceptions never arrive
 * here — they're resolved inside the GraphQL engine before MVC advice
 * could see them. Two transports, two adapters, same domain exceptions.
 *
 * Responses use ProblemDetail (RFC 7807 "problem+json") — the standard
 * error body shape built into Spring 6, instead of an ad-hoc error record
 * every codebase reinvents slightly differently.
 */
@RestControllerAdvice
public class RestExceptionHandler {

    // 409 Conflict, not 400: the request was well-formed; it conflicts
    // with existing STATE (the account). Same enumeration trade-off as
    // documented on the exception itself.
    @ExceptionHandler(EmailAlreadyRegisteredException.class)
    ProblemDetail handleEmailTaken(EmailAlreadyRegisteredException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
    }

    // Covers BadCredentialsException and friends thrown by the
    // AuthenticationManager during login. Fixed vague message on purpose:
    // "no such user" and "wrong password" must be indistinguishable.
    @ExceptionHandler(AuthenticationException.class)
    ProblemDetail handleBadCredentials(AuthenticationException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, "Invalid email or password");
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ProblemDetail handleNotFound(ResourceNotFoundException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    // Same 409-because-of-STATE reasoning as the email conflict above:
    // the request was fine, the row just moved on. GraphQL twin: the
    // CONFLICT classification in GraphqlExceptionResolver.
    @ExceptionHandler(StaleVersionException.class)
    ProblemDetail handleStaleVersion(StaleVersionException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
    }

    // Bean Validation failures on @Valid @RequestBody. Collect ALL field
    // errors, not just the first — a form should be fixable in one round
    // trip, not by whack-a-mole.
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        for (FieldError error : ex.getBindingResult().getFieldErrors()) {
            fieldErrors.putIfAbsent(error.getField(), error.getDefaultMessage());
        }
        ProblemDetail problem =
                ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        problem.setProperty("errors", fieldErrors);
        return problem;
    }

    // Domain invariants (e.g. User.normalizeEmail rejecting garbage) —
    // the caller's fault, same classification as in the GraphQL resolver.
    @ExceptionHandler(IllegalArgumentException.class)
    ProblemDetail handleBadInput(IllegalArgumentException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
    }
}
