package com.cotune.common.graphql;

import graphql.ErrorClassification;

/**
 * Error categories the API needs beyond Spring GraphQL's built-in
 * ErrorType enum (which has no CONFLICT). Implementing ErrorClassification
 * lets GraphqlErrorBuilder serialize it into extensions.classification
 * exactly like the built-ins — clients can't tell the difference.
 */
public enum CotuneErrorType implements ErrorClassification {

    /** Optimistic-concurrency failure: reload and re-apply (HTTP 409's twin). */
    CONFLICT,

    /** A dependency the server needs is missing or refusing (HTTP 503's
     *  twin) — not the caller's fault, not a bug: retry later or ask the
     *  operator. Today: the AI feature keyless, rate-limited, or erroring. */
    UNAVAILABLE
}
