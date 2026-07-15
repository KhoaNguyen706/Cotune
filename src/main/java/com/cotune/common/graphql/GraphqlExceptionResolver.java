package com.cotune.common.graphql;

import com.cotune.ai.PatternGenerator;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.exception.StaleAccountException;
import com.cotune.common.exception.StaleVersionException;
import graphql.GraphQLError;
import graphql.GraphqlErrorBuilder;
import graphql.schema.DataFetchingEnvironment;
import jakarta.validation.ConstraintViolationException;
import org.springframework.graphql.execution.DataFetcherExceptionResolverAdapter;
import org.springframework.graphql.execution.ErrorType;
import org.springframework.stereotype.Component;

import java.util.stream.Collectors;

/**
 * GraphQL has no HTTP status codes — every response is 200, and failures
 * travel in the "errors" array of the response body. This resolver is the
 * GraphQL equivalent of a REST @ControllerAdvice: one central place that
 * maps domain exceptions to API error categories.
 */
@Component
public class GraphqlExceptionResolver extends DataFetcherExceptionResolverAdapter {

    @Override
    protected GraphQLError resolveToSingleError(Throwable ex, DataFetchingEnvironment env) {
        if (ex instanceof ResourceNotFoundException notFound) {
            return GraphqlErrorBuilder.newError(env)
                    .errorType(ErrorType.NOT_FOUND)
                    .message(notFound.getMessage())
                    .build();
        }

        // Valid signature, vanished account (deleted user or a token from
        // another environment's database). UNAUTHORIZED tells the client
        // "drop this session and log in again".
        if (ex instanceof StaleAccountException stale) {
            return GraphqlErrorBuilder.newError(env)
                    .errorType(ErrorType.UNAUTHORIZED)
                    .message(stale.getMessage())
                    .build();
        }

        // Bean Validation failures on @Valid GraphQL arguments. Without
        // this mapping they fall through to INTERNAL_ERROR — which hides
        // the caller's mistake AND swallows the helpful message (found by
        // probing updateTrackPattern with a bad pitch during verification).
        // The REST twin of this mapping lives in RestExceptionHandler.
        if (ex instanceof ConstraintViolationException violations) {
            String message = violations.getConstraintViolations().stream()
                    .map(v -> v.getPropertyPath() + ": " + v.getMessage())
                    .sorted() // deterministic order — violations come as a Set
                    .collect(Collectors.joining("; "));
            return GraphqlErrorBuilder.newError(env)
                    .errorType(ErrorType.BAD_REQUEST)
                    .message(message)
                    .build();
        }

        // Optimistic-concurrency conflict: not the caller's mistake and not
        // a server fault — a third category ("someone got there first"),
        // hence its own classification instead of BAD_REQUEST.
        if (ex instanceof StaleVersionException stale) {
            return GraphqlErrorBuilder.newError(env)
                    .errorType(CotuneErrorType.CONFLICT)
                    .message(stale.getMessage())
                    .build();
        }

        // The AI feature saying "not now": keyless deploy, provider rate
        // limit, provider outage. The exception's message is written to be
        // shown to the person, so it passes through — unlike the generic
        // INTERNAL_ERROR fallthrough below, which would swallow it.
        if (ex instanceof PatternGenerator.GenerationUnavailableException unavailable) {
            return GraphqlErrorBuilder.newError(env)
                    .errorType(CotuneErrorType.UNAVAILABLE)
                    .message(unavailable.getMessage())
                    .build();
        }

        // Auth exceptions are deliberately absent: register/login live on
        // REST (AuthRestController), handled by RestExceptionHandler.
        // AccessDeniedException from @PreAuthorize is also not handled
        // here — Spring GraphQL's built-in security resolver already maps
        // it to FORBIDDEN/UNAUTHORIZED.

        // IllegalArgumentException here means a domain invariant fired
        // (e.g. Song.changeTempo rejected the value) — the caller's fault,
        // so classify as BAD_REQUEST rather than a server error.
        if (ex instanceof IllegalArgumentException badInput) {
            return GraphqlErrorBuilder.newError(env)
                    .errorType(ErrorType.BAD_REQUEST)
                    .message(badInput.getMessage())
                    .build();
        }

        // Returning null = "not handled here". Spring then emits a generic
        // INTERNAL_ERROR without the exception message — deliberate, so
        // stack traces and SQL details never leak to API clients.
        return null;
    }
}
