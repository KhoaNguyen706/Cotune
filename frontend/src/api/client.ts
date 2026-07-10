import type { AuthPayload } from "../types";

/**
 * One error shape for the whole app, no matter which transport failed.
 * The backend speaks two error dialects — REST problem+json (status codes,
 * optional field errors) and GraphQL errors[] (always HTTP 200, with a
 * classification) — and this module translates BOTH into ApiError so the
 * UI never needs to know which wire format a failure arrived on.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status for REST; mapped from classification for GraphQL. */
    readonly status: number,
    /** field -> message, from validation failures (400s). */
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

const STORAGE_KEY = "cotune.auth";

// localStorage is the pragmatic choice for a learning project, made with
// eyes open: any XSS can read it and steal the token. The hardened
// alternative is an httpOnly cookie (JS can't read it) — but that
// reintroduces CSRF, which we explicitly disabled server-side. Trade-off
// to revisit before anything public.
export function loadSession(): AuthPayload | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const session: AuthPayload = JSON.parse(raw);
  // Token expiry is enforced by the server on every request anyway; this
  // client-side check just avoids greeting the user as logged-in and then
  // failing their first click.
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return session;
}

export function saveSession(session: AuthPayload): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function authHeader(): Record<string, string> {
  const session = loadSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

/** REST call to /api/**. Throws ApiError on any non-2xx. */
export async function rest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    // RFC 7807 problem+json: { detail, status, errors? } — errors is the
    // field map our RestExceptionHandler adds for validation failures.
    const problem = await response.json().catch(() => null);
    throw new ApiError(
      problem?.detail ?? `Request failed (${response.status})`,
      response.status,
      problem?.errors ?? {},
    );
  }
  return response.json();
}

/** GraphQL call. Throws ApiError if the response carries errors[]. */
export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: JSON.stringify({ query, variables }),
  });

  // A tampered/expired token is rejected by the security filter BEFORE
  // GraphQL runs, so it arrives as a real HTTP 401 — the one case where
  // /graphql doesn't answer 200.
  if (response.status === 401) {
    throw new ApiError("Session expired — please sign in again", 401);
  }

  const json = await response.json();
  if (json.errors?.length) {
    const classification = json.errors[0].extensions?.classification;
    const status =
      classification === "UNAUTHORIZED" ? 401
      : classification === "FORBIDDEN" ? 403
      : classification === "NOT_FOUND" ? 404
      : 400;
    throw new ApiError(json.errors[0].message, status);
  }
  return json.data;
}
