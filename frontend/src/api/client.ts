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

// Web Storage is the pragmatic choice for a learning project, made with
// eyes open: any XSS can read it and steal the token. The hardened
// alternative is an httpOnly cookie (JS can't read it) — but that
// reintroduces CSRF, which we explicitly disabled server-side. Trade-off
// to revisit before anything public.
//
// WHICH storage is a privacy setting the user owns (Settings → Privacy):
//   localStorage   — survives closing the browser ("remember this device")
//   sessionStorage — dies with the tab (shared or public machine)
// Same API, different lifetime, so one helper picks the target and
// everything else below is unchanged.
function store(): Storage {
  try {
    return localStorage.getItem("cotune.rememberDevice") === "false"
      ? sessionStorage
      : localStorage;
  } catch {
    return sessionStorage; // storage disabled entirely (private mode)
  }
}

export function setRememberDevice(remember: boolean): void {
  // The FLAG itself must outlive the tab even when the SESSION doesn't —
  // otherwise "don't remember me" would be forgotten on reload, which is
  // exactly backwards. It holds no secret, only a preference.
  localStorage.setItem("cotune.rememberDevice", String(remember));
  // Move any live session to the newly chosen storage, so flipping the
  // switch takes effect immediately instead of at next login.
  const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  if (raw) store().setItem(STORAGE_KEY, raw);
}

export function loadSession(): AuthPayload | null {
  const raw = store().getItem(STORAGE_KEY);
  if (!raw) return null;
  const session: AuthPayload = JSON.parse(raw);
  // Token expiry is enforced by the server on every request anyway; this
  // client-side check just avoids greeting the user as logged-in and then
  // failing their first click.
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    store().removeItem(STORAGE_KEY);
    return null;
  }
  return session;
}

export function saveSession(session: AuthPayload): void {
  store().setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  // Clear BOTH: the setting may have changed since the token was written,
  // and a "signed out" user with a token stranded in the other storage is
  // the worst possible bug in this file.
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

function authHeader(): Record<string, string> {
  const session = loadSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

/**
 * Session-death interceptor: when the server answers UNAUTHORIZED while we
 * HOLD a token, that token is dead (expired, or referencing an account
 * that no longer exists — e.g. minted against a different database).
 * Holding onto it means every subsequent click fails identically, so drop
 * it and land on /login. Deliberately NOT applied when there's no session:
 * a failed login attempt is a normal 401, not a dead session.
 */
function onUnauthorized(): void {
  if (loadSession()) {
    clearSession();
    window.location.assign("/login");
  }
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
    if (response.status === 401) onUnauthorized();
    throw new ApiError(
      problem?.detail ?? `Request failed (${response.status})`,
      response.status,
      problem?.errors ?? {},
    );
  }
  // 204 No Content (DELETEs) has no body — json() would throw on it.
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

/**
 * Multipart upload — its own helper because rest() hard-codes a JSON
 * Content-Type. Here the browser must set the multipart boundary header
 * itself (setting it by hand breaks the request), so we only add auth.
 */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: authHeader(),
    body: form,
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    if (response.status === 401) onUnauthorized();
    throw new ApiError(
      problem?.detail ?? `Upload failed (${response.status})`,
      response.status,
      problem?.errors ?? {},
    );
  }
  return response.json();
}

/** Authenticated binary GET (audio downloads) — bytes, not JSON. */
export async function fetchBinary(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path, { headers: authHeader() });
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    throw new ApiError(`Download failed (${response.status})`, response.status);
  }
  return response.arrayBuffer();
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
    onUnauthorized();
    throw new ApiError("Session expired — please sign in again", 401);
  }

  const json = await response.json();
  if (json.errors?.length) {
    const classification = json.errors[0].extensions?.classification;
    const status =
      classification === "UNAUTHORIZED" ? 401
      : classification === "FORBIDDEN" ? 403
      : classification === "NOT_FOUND" ? 404
      : classification === "CONFLICT" ? 409
      : 400;
    if (status === 401) onUnauthorized();
    throw new ApiError(json.errors[0].message, status);
  }
  return json.data;
}
