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
    CONFLICT
}
