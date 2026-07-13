# Cotune Roadmap — scale, features, and the AI question

Written 2026-07-13, right after the first production deploy. Grounded in what is
actually running: one Heroku Basic dyno (512MB, capped JVM), Supabase for
Postgres + audio objects, the Redis relay **built and tested but switched off**
(one dyno doesn't need it), 99 backend tests, and a frontend that was just
refactored into hooks.

The honest starting point: **this app has no traffic yet.** The plan below is
ordered so that every step is worth doing at the moment you reach it — nothing
here is "build a Kubernetes cluster in case we go viral." Premature scaling is
how side projects die with zero users and a $200/month bill.

---

## Phase 1 — Harden what exists (days, do before inviting users)

These are the gaps that bite at exactly ten users, found during this session's
deploy work:

**1. Rate limiting — the most important missing piece.** `/api/auth/register`
and `/api/auth/login` are open endpoints running BCrypt, which is *designed* to
burn CPU. One `curl` loop from one laptop can pin the dyno's CPU and take the
whole app down — no botnet required. A `bucket4j` filter (in-memory, per-IP,
~10 attempts/min on auth endpoints, generous elsewhere) closes this. In-memory
is correct at one dyno; move the buckets to Redis only when `web > 1`.

**2. Health endpoint.** There is no `/actuator/health`, so Heroku can only
TCP-probe the dyno — it knows the port is open, not that the app can reach its
database. Add `spring-boot-starter-actuator`, expose health only, keep it
unauthenticated but information-free (`show-details: never` in prod).

**3. Session lifetime.** JWTs expire after 1h with no refresh mechanism — a
musician mid-session gets silently logged out and their next save fails. Either
add refresh tokens (proper, more work) or consciously accept a longer TTL
(pragmatic; document the revocation trade-off). Decide, don't drift.

**4. The timeline's missing `readOnly` gate.** A VIEWER can drag clips in the
UI; the server correctly 403s each attempt, but the user experiences errors
instead of disabled controls — the exact "session 14 403 storm" pattern, in the
one component that never got the fix. Thread `canEdit` into
`ArrangementTimeline` and gate the handlers.

**5. Frontend smoke test in CI.** The hooks refactor shipped a reload-loop bug
that `tsc` and the build both passed; a real browser caught it. That Playwright
check (login → open song → draw note → socket up → zero console errors) should
run on every push. The `data-testid="piano-roll"` hook is already in place.

---

## Phase 2 — Scale (when there are actual users; measure first)

**What "high traffic" means for this app, specifically:** not CPU. The load
profile is (a) many long-lived WebSocket connections, (b) a burst of tiny STOMP
frames per active editor, (c) a shared Postgres pool ceiling, (d) audio bytes.
Scale plans that don't name their bottleneck are decoration.

**Step 0 — baseline before changing anything.** A k6 script that simulates N
concurrent editors (connect socket, subscribe, send note ops at human speed)
against a staging app. Find the number where p95 latency degrades. Everything
after this step is driven by that number, not by vibes.

**Step 1 — vertical, one dyno (cheap, boring, effective).** Basic → Standard-2X
(1GB) and raise `-Xmx` accordingly in `heroku.yml`. A single decent JVM
comfortably holds thousands of idle WebSocket connections; the beat grid's
traffic is tiny. This is likely enough for hundreds of concurrent users.

**Step 2 — horizontal (the part that's already built).** `heroku ps:scale
web=2` + Redis add-on + `REALTIME_RELAY=redis` + `SPRING_DATA_REDIS_URL`. The
relay was session 19's whole point and is proven by a two-JVM integration test
and a live compose cluster. Two things to respect when flipping it on:

- **The Hikari × dynos arithmetic.** Pool is 5 per dyno by design; Supabase's
  session-mode pooler has a hard client ceiling (check your plan's limit).
  Dynos × 5 must stay under it. The prod profile already caps this — the
  ceiling is the thing to know, not to fix.
- **Heroku Redis uses self-signed TLS** — budget a few minutes for
  `rediss://` certificate verification settings on Lettuce the first time.

**Step 3 — only when measured, not before.**
- **Shard the relay channel by song id** when instances drown in traffic for
  songs they don't host. `RelaySubscriber` documents exactly where the two-line
  change goes (`ChannelTopic` → `PatternTopic`).
- **Audio through a CDN** (Cloudflare in front of `GET /api/audio/{id}`, or
  Supabase Storage signed URLs) when bandwidth becomes the dyno's job. Until
  then, `Cache-Control: private, max-age=86400` on the audio endpoint is one
  line and removes repeat downloads — audio files are immutable by id.
- **Observability**: Micrometer + a free Grafana Cloud, dashboarding exactly
  four things — WebSocket session count, Redis publish rate, Hikari pool
  saturation, p95 request latency. These four answer every "is it the app or
  the database" question this architecture can produce.

---

## Phase 3 — Features (the product, not the plumbing)

Chosen because each one compounds what exists rather than bolting on:

**1. Song version history.** The op-log architecture deliberately deferred in
early sessions ("ship over op dispatcher") becomes worth it the moment two
humans share a song: "who deleted my bassline and when, and give it back."
An append-only `song_events` table written from the same code path that
broadcasts ops — the schema was explicitly designed to accommodate this without
a rewrite. Restore = replay. This is the single highest-value feature and it's
also the best interview story: it completes an architectural arc.

**2. Public listen links.** A read-only share token (`/listen/:token`) that
plays a song without an account. The permission model already has VIEWER;
this is VIEWER-without-login. It's how users show their work, which is how the
app spreads. Small: one token column, one public GraphQL query, one page that
reuses the existing playback engine.

**3. Mixer persistence.** Mute/solo/volume are client-side and vanish on
reload. Musicians expect a mix to be part of the song. Per-lane `volume`/`pan`
columns + the existing PATCH pattern + version column. Straightforward, and it
makes the collab story richer (your collaborator hears your mix).

**Deliberately not on the list:** mobile app, DAW-grade audio effects, video
chat. Each is a company, not a feature.

---

## Phase 4 — AI: not needed, one feature worth doing

**Honest answer to "do I need AI?": no.** Cotune's core value — real-time
collaborative editing — needs zero AI, and a weak bolted-on chatbot would
subtract credibility rather than add it.

**But one feature fits this architecture so well it's worth building: AI
pattern generation.** "Give me a boom-bap drum pattern" → a new lane full of
notes, appearing live on every collaborator's grid.

Why this one, specifically:

- **It reuses the delta machinery end-to-end.** Claude returns a list of
  `NoteOp`s — the exact `{type: ADD, step, pitch, velocity, length}` shape the
  wire already speaks. The server applies them through the same
  `TrackService.applyNote` merge (locking, validation, version bump) and
  broadcasts through the same relay. Collaborators see AI notes flash in like
  any human edit. Undo works because it's just notes. **No new merge logic, no
  new wire format, no trust in model output** — every op is validated like a
  human's.
- **Structured outputs make it reliable.** The Claude API can constrain the
  response to a JSON schema (`output_config.format` in the Java SDK,
  `com.anthropic:anthropic-java`), so "the model returned malformed JSON"
  is not a failure mode you handle.
- **The economics are a non-issue.** A generation is ~1K tokens in, ~1-2K out.
  On `claude-opus-4-8` ($5/$25 per MTok) that is **$0.03–0.06 per generation**;
  if cost ever matters, `claude-haiku-4-5` does simple 16-step patterns at
  under a cent. Rate-limit it per user (Phase 1's bucket4j) and the worst-case
  bill is lunch money.
- **Server-side only.** The endpoint lives behind the existing JWT auth
  (`POST /api/songs/{id}/generate`), the API key lives in a Heroku config var,
  and the browser never talks to Anthropic. `canEdit` gates it like any edit.

Scope it tightly: one endpoint, drums + melody prompts, notes land on a chosen
lane as ordinary dirty state the user can audition and undo before it ever
saves. Skip audio ML (stem separation, audio generation) — heavy infra, weak
fit, different product.

---

## Order of operations

```
now ──► Phase 1 (harden)          days     — before inviting anyone
        Phase 3.2 (listen links)  ~a week  — the growth loop, cheap
        Phase 4 (AI generation)   ~a week  — the demo feature, cheap
        Phase 3.1 (version history) weeks  — the depth feature
        Phase 2 (scale steps)     as traffic demands, measured, in order
```

Phase 2 is intentionally *after* the feature work in calendar terms: the
scaling path is already designed and mostly built (that was sessions 19–20), so
it can be executed on demand in a day. Features and hardening can't.
