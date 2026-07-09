package com.cotune.common.graphql;

import com.cotune.common.exception.ResourceNotFoundException;
import graphql.GraphQLError;
import graphql.GraphqlErrorBuilder;
import graphql.schema.DataFetchingEnvironment;
import org.springframework.graphql.execution.DataFetcherExceptionResolverAdapter;
import org.springframework.graphql.execution.ErrorType;
import org.springframework.stereotype.Component;

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
