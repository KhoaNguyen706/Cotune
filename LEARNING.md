# Cotune — Know Your Own Project

A guide for (1) recording the demo video and (2) explaining every part of this
project in an interview without reading code on the spot. Everything here is
verifiable in the repo — file paths are given so you can re-read the source of
any claim.

---

## 1. The one-sentence pitch

> **Cotune is a real-time collaborative music editor**: multiple people build
> the same beat in the browser at the same time, with live cursors, chat, an
> AI co-producer, and a public listen page — Spring Boot + GraphQL + WebSocket
> on the backend, React + Tone.js on the frontend, deployed on Heroku with
> Supabase (Postgres + object storage).

If you get one follow-up question, it will be "how does real-time work?" —
see §4.3. Know that section cold.

---

## 2. Tech stack (say it in this order)

| Layer | Technology | Where |
|---|---|---|
| Backend | Java 21, Spring Boot | `src/main/java/com/cotune/` |
| API | GraphQL (data) + REST (auth, audio bytes) | `src/main/resources/graphql/schema.graphqls` |
| Realtime | STOMP over WebSocket, Redis pub/sub relay for multi-instance | `com.cotune.realtime` |
| Database | PostgreSQL, schema owned by Flyway (V1–V15) | `src/main/resources/db/migration/` |
| AI | Gemini function-calling | `com.cotune.ai` |
| Frontend | React + Vite + TypeScript | `frontend/src/` |
| Sound | Tone.js — browser synthesizes everything | `frontend/src/audio/engine.ts` |
| Storage | Supabase Storage (prod) / local disk (dev) | `com.cotune.audio` |
| Deploy | Docker image → Heroku container stack, CI on GitHub Actions | `Dockerfile`, `heroku.yml`, `.github/workflows/ci.yml` |

**Key design fact to lead with:** *beats are data, not audio.* A pattern is a
JSONB array of `{step, pitch, velocity, length}` events on the track row; the
browser synthesizes all sound with Tone.js. That's why collaboration is
possible at all — you sync tiny note events, not audio files.

---

## 3. Architecture in 90 seconds

**Package-by-feature**, classic layering inside each feature:

```
GraphQL request
  → *GraphqlController   (transport: schema field ↔ method, validation)
  → *Service / Impl      (use cases, transaction boundaries)
  → *Repository          (Spring Data JPA)
  → PostgreSQL           (schema owned by Flyway)

Mappers translate Entity ↔ DTO at the service boundary;
entities never cross the API surface.
```

The features (each is a package under `com.cotune`):
`auth`/`user` (JWT), `song`, `beat`, `track` (lanes + patterns), `clip`
(arrangement timeline), `collab` (sharing/roles), `realtime` (WebSocket),
`chat`, `ai` (pattern generator + beat composer + chat advisor), `audio`
(uploads), `listen` (public share links), `history` (activity feed).

**Why auth is REST but data is GraphQL** — an interviewer may ask:
credentials stay out of GraphQL query logs; each auth endpoint gets real HTTP
status codes and URL-level security rules. `/graphql` is one URL for all
operations, so the URL can't carry auth rules — authorization is
per-operation via `@PreAuthorize` on resolvers instead.

**JWT is stateless**, rides the `Authorization: Bearer` header, lives in
localStorage. Roles ride *inside* the token (that's why a promoted admin
must re-login).

---

## 4. The features, and how each one works

Order below ≈ good demo order. For each: what it is, how it works, and the
one detail that proves you understand it.

### 4.1 Songs, sharing & permissions

- A song has one **OWNER**, plus **EDITOR** / **VIEWER** collaborators
  (`song_collaborators` table, migration V10).
- The permission matrix: OWNER = everything; EDITOR = view + edit music (but
  **not** share, not delete); VIEWER = view only.
- **The detail that matters:** the whole rule lives in ONE class,
  `SongAccess`. Every child resource (beat, lane, clip, audio) resolves up
  to its song and delegates there. The server sends the client its role as
  `myRole` on every song — the client *branches on that*, never computes its
  own. Why? An earlier version had the UI keeping its own copy of the edit
  rule; the copies drifted and produced a storm of 403s. Single source of
  authority fixed it.
- Why can't an EDITOR share? Because "can change the music" and "can change
  who gets in" are different powers — an editor who could share could invite
  more editors and access would escalate away from the owner unseen.

### 4.2 The beat editor (the core screen)

- 16-step sequencer grid (`frontend/src/pages/BeatMakerPage.tsx`,
  `frontend/src/beatmaker/BeatEditorCanvas.tsx`). A bar = 16 sixteenth-note
  steps; a beat can span multiple bars.
- Notes have step, pitch (scientific notation like `C2`, `F#4`), velocity,
  length.
- Edits mark a lane *dirty* and flush on a **1-second debounce** — the mouse
  code never talks to the network directly.
- Saves are guarded by **optimistic locking**: mutations carry
  `expectedVersion`, and a stale write is *refused*, never silently clobbered.
- Sound: `frontend/src/audio/engine.ts` + `instruments.ts` schedule Tone.js
  synths from the pattern data. `mp3.ts` handles export. (Worth opening
  `engine.ts` before the demo — it's the bridge between "data" and "sound",
  and a likely interview question: "so where does the audio come from?")

### 4.3 Real-time collaboration ⭐ (the headline feature — know this cold)

Two editors draw on the same grid and see each other's notes appear live.

**Transport:** STOMP over a native WebSocket at `/ws`. The handshake is
unauthenticated *by necessity* — a browser's `WebSocket` constructor cannot
set an `Authorization` header — so the JWT rides in the STOMP `CONNECT`
frame and `StompAuthChannelInterceptor` authenticates there. An
unauthenticated socket can open but can do *nothing*: SUBSCRIBE refused,
SEND refused by `@PreAuthorize`. (The common alternative, `?token=` in the
URL, leaks the credential into access logs and browser history — good
interview line.)

**Message flow — clients can never publish straight to a topic:**

```
client --SEND--> /app/songs/{id}/notes    (@PreAuthorize canEdit → merge → persist)
                       ↓
      <--broadcast-- /topic/songs/{id}    (SUBSCRIBE requires canView)
```

Every message anyone hears has been authorized, validated, merged and
persisted first.

**Deltas, not blobs — the most important design decision in the project.**
The wire carries `NOTE_ADD` / `NOTE_REMOVE`, never the whole lane. If two
editors each sent their whole pattern array, the second write would erase
the other's note simply because their snapshot never contained it. A delta
says what *changed*; the server merges it into whatever the lane holds now
(`TrackServiceImpl.applyNote`, with `SELECT ... FOR UPDATE`, merging by
`(step, pitch)` — a note's identity). Both ops are idempotent, so a client
can re-send one it isn't sure landed. The 1s debounce flush *diffs* the lane
against the last server-confirmed state — a note move falls out naturally as
REMOVE + ADD.

**Fallback:** socket down → whole-pattern GraphQL save, still protected by
`expectedVersion`.

**Presence:** collaborators' cursors glide across the grid, labelled and
colored by a **hash of the user id** (Bob is the same green on everyone's
screen, forever, with no stored mapping). Notes placed by others *flash*.
The server keeps **no session registry** — it stamps identity from the
signed token onto each frame and relays it, remembering nothing. Clients
heartbeat every 3s, expire peers after 8s. Why no registry? It would leak an
entry every time a laptop lid closes, and it would be wrong with two
instances. Identity always comes from the token, never the payload —
otherwise anyone could paint a cursor labelled "Alice".

### 4.4 Scaling past one instance (Redis relay)

Spring's simple broker is in-memory — correct for one instance, broken for
two (a note sent to instance A never reaches a subscriber on B).
`RealtimeBroadcaster` (`com.cotune.realtime.relay`) is the seam:

- `local` (default) — this JVM's broker; dev stays zero-dependency.
- `redis` — PUBLISH every event; every instance (including the sender's own)
  delivers its copy off the channel. **One delivery path** — the naive "send
  locally AND publish" would echo the sender's message back and deliver
  duplicates.

If Redis dies mid-edit, in-flight frames are lost but work never is: every
op was persisted to Postgres *before* it was published.
`RedisRelayIntegrationTest` boots two real Spring contexts + Redis +
Postgres via Testcontainers and asserts the crossing works exactly once.

### 4.5 The arrangement timeline (clips)

Video-editor-style: arm material in the sidebar, click a lane to place a
clip. Drag = move (snaps to bar), drag right edge = resize (a beat clip
*loops* its pattern to fill), **alt+drag = duplicate**, right-click =
delete, double-click = open the beat editor.

- Duplicate is a *drag of a copy*, not a command — a command has to guess
  where the copy goes; dragging says "here".
- A duplicated beat clip points at the **same beat**, not a copy — edit the
  beat once, every placement changes. That's why the arrangement stores
  clips, not note data.

### 4.5b Preset beats (the ngũ cung pack)

Six ready-made multi-lane beats — a festival drum groove, a zither cascade,
a lullaby, a lofi-folk groove, a flute lead, a break-and-roll — inserted with
one click and then arranged on the timeline like any other beat.
`frontend/src/beatmaker/presets.ts`.

**The point of the feature:** almost nobody writes a song by drawing every
note from an empty grid. They assemble finished parts. §4.5 already built the
assembling; this is the box of parts.

**The three decisions to talk about:**

- **It ships composition, not sound design.** There is no đàn tranh *voice*
  here. What makes these read as Vietnamese is the **notes** — traditional
  Vietnamese music is pentatonic (ngũ cung), and that mode survives being
  played on a plucked-string synth. So the pack adds zero instruments, zero
  samples, zero bytes of storage. The alternative (sampling real instruments)
  is the version that needs a bucket, a CDN and licensing — a different
  project, correctly deferred.
- **One key for the whole pack: A C D E G.** Simultaneously A-minor and
  C-major pentatonic — the same five notes, heard as dark or bright depending
  which one the part leans on. That single pool is what makes *any two*
  presets stackable, which is the difference between a pack you arrange and a
  pack you audition one at a time. `presets.test.ts` **enforces** it rather
  than trusting it, and exempts drums (a pitched membrane synth, so its
  "pitch" is a drum size, not a note).
- **A preset IS an AI plan.** `presetToPlan()` returns the same `AiAction[]`
  the composer returns, and the page's `applyActions()` lands both. The apply
  path is not trivial — lanes before notes, one history snapshot so Ctrl+Z
  takes the whole insert back, notes flushed as per-note deltas collaborators
  watch arrive. A second bespoke insert path would have been the *untested*
  copy of all that. (Insert also never emits `SetBpm`: dropping a part into a
  song must not retempo the five beats already in it. The suggested tempo is
  displayed, not applied.)

**The test is the interesting artifact.** Hand-written note data rots
silently, and the failure is remote and late — the server rejects a note one
step too long, in a dialog, in front of the user. So `presets.test.ts`
duplicates the server's bounds *on purpose* (`Step.java`'s pitch regex,
`Beat.MAX_BARS`, the `step + length <= bars*16` rule) and is the tripwire for
them drifting. 28 assertions, no key, no browser, 12 ms.

### 4.6 AI features (three of them, one Gemini client)

All gated the same way: song edit access + **invite list** (`aiAccess` flag
granted by an admin, migration V13) + a shared **10-second per-user
cooldown** (`AiGraphqlController` — one cooldown map for both mutations so a
caller can't alternate between them to double their rate).

1. **Pattern generator** (`PatternGenerator`) — "give me a boom-bap kick" →
   notes for ONE lane. The answer's shape is fixed before the call.
2. **Beat composer** (`BeatComposer`) ⭐ — "make me a sad lofi beat" → the
   model *decides what to do* via function-calling tools (`set_bpm`,
   `set_time_signature`, `add_lane`, `set_lane_pattern`, `clear_lane`,
   `remove_lane`). The current beat is shown to it as text grids (`x` = hit,
   `—` = held, `.` = silence). The system prompt tells it the request leads
   (honor named instruments/tempo/meter first) and gives real per-genre
   tempo ranges so a "house beat" lands near 124, not a guess.
3. **Chat advisor** (`ChatAiBridge` / `AiAdvisor`) — mention the AI in song
   chat, it answers with advice.

**The two design decisions to talk about:**

- **The model proposes; it never executes.** `composeBeat` returns a *plan*
  (list of `AiAction`) — nothing writes to the DB. The client previews the
  plan, and on Apply executes it through the ordinary edit mutations. Undo,
  the dirty-flush, and the realtime broadcast all work *without knowing an
  AI was involved*. An AI that saved its own plan would be an AI with write
  access to your song — and the first thing you'd want back is the undo it
  skipped. This is also why `remove_lane` (a *destructive* tool, added on
  request) is safe to offer: the plan lists "Remove the X lane", the dialog
  flags it irreversible, and the delete only happens on Apply through the
  same `deleteTrack` a person uses. The model's reach stays a **subset of
  the user's own powers** — it can do nothing you couldn't do by hand.
- **Every argument is re-validated server-side** (`BeatComposer.validate`).
  Gemini's schema constrains the JSON's *shape*, not its meaning — nothing
  stops a schema-valid call naming instrument "SAD" or BPM 900. Each call is
  rebuilt through the same domain rules a human edit meets and dropped if it
  fails; a bad call costs one action, never the whole plan. "The tool list
  is not a security boundary; the validator is."

Frontend: `frontend/src/beatmaker/plan.ts` is a **pure module** used by both
the preview and the apply — one reading of the plan, used twice, so the
preview can never lie about what apply will do. It's also the only way the
logic gets unit-tested (`plan.test.ts`) without spending Gemini tokens.
Retry safety: re-pressing Apply after a half-failure filters out lanes that
now exist, so you never get two lanes named "drums".

### 4.7 Chat

Per-song chat (`com.cotune.chat`, V11), delivered over the same WebSocket
topics, persisted in Postgres. The AI advisor hooks in here too. Same
authorization: you must be able to view the song to read the room.

### 4.8 Audio uploads & samples

Upload a sample → `com.cotune.audio`. Storage is behind an interface
(`AudioStorage`): `LocalAudioStorage` (dev disk) vs `SupabaseAudioStorage`
(prod object storage — a Heroku dyno's filesystem is ephemeral, so `local`
in prod would lose every upload daily). The browser **never talks to
Supabase directly** — it fetches `GET /api/audio/{id}` from the backend,
authorized by `AudioAccess`, so the bucket stays private and there's no
second permission model to drift. Audio bytes are on REST, not GraphQL,
because GraphQL is a poor fit for binary streaming.

### 4.9 Public listen page

`com.cotune.listen` + `frontend/src/pages/ListenPage.tsx`. A song gets a
**listen token** (V12) — an unguessable link anyone can open *without an
account* to hear the song. Read-only DTOs (`ListenSongDto` etc.) expose only
what playback needs — no emails, no collaborator lists.

### 4.10 History / activity feed

`com.cotune.history` (V15, `song_events`): who did what, when, shown in the
UI. Note this is an *activity feed*, not an event-sourcing log — the
`pattern` column stays the single source of truth. (You deliberately chose
coarse CRUD mutations over an operation log — simpler, and the realtime
deltas exist only in flight.)

### 4.11 Admin page + the handbook

- `/admin` (`AdminPage.tsx`): manage users, grant `aiAccess`. ADMIN is an
  **app-level role, a different axis from per-song roles** — an admin still
  cannot edit someone else's song; their only song power is over ownerless
  legacy rows.
- `/handbook` (`HandbookPage.tsx`): shows what the AI was told — the system
  prompt and tools — in a tab. Nice transparency touch to show in the demo.

### 4.12 Observability (Micrometer → Prometheus)

`/actuator/prometheus` exposes metrics in Prometheus' text format. Boot's
actuator ships Micrometer's *facade*; `micrometer-registry-prometheus` (runtime
scope) supplies the *backend*. Application code imports `io.micrometer.core`
and never names Prometheus, so swapping to Datadog or OTLP is a one-line
dependency change.

**Free from Boot:** HTTP latency per endpoint (with histogram buckets enabled,
so p95/p99 are computable at query time — a mean latency hides the tail, which
is the part users feel), JVM heap and GC, Hikari pool saturation.

**Ours** (`com.cotune.common.metrics.CotuneMetrics`, one class so meter names
are compiler-checked rather than typo-able strings):

| Metric | Why it exists |
|---|---|
| `cotune.realtime.broadcast` | Events published, tagged by type and relay mode |
| `cotune.realtime.relay.delivered` | Events received back off Redis. Compared against the above, this is the **only external evidence the fan-out works**: N instances should deliver ~N per publish, and a ratio sagging to 1 means instances stopped hearing each other — invisible to anyone testing alone, because you always see your own edits |
| `cotune.ai.plan.action{outcome}` | Tool calls kept vs **dropped by the validator**. Rising drops = the model drifting from what the domain accepts, otherwise invisible because a partly-dropped plan still returns a good-looking beat |
| `cotune.conflict.stale.version` | Optimistic-lock refusals — the one error that isn't a fault. A steady low rate is the lock working; a spike is real contention or a client stuck retrying |

**The two decisions to talk about:**

- **Metrics are ADMIN-only; health is public.** Deliberate asymmetry. Health
  answers one bit. The metrics dump lists every URI template (a free map of the
  API), per-endpoint traffic, and JVM internals — no credentials, but pure
  reconnaissance. The usual excuse for leaving it open is "the scraper is on a
  private network"; a Heroku dyno *has* no private network, so that would be a
  statement of intent, not of fact. Reused `hasRole('ADMIN')` rather than
  minting a scrape secret, since a second credential type is a second thing to
  rotate and forget. (Caveat to volunteer: our JWTs expire in 12h, so a real
  scraper needs a service account, not a pasted token.)
- **Cardinality is the way a metrics change hurts production.** Every distinct
  tag combination is a stored time series, so one `songId` label turns one
  metric into millions. Every tag above comes from a closed set — a sealed
  interface of three event types, a relay mode, a two-valued outcome.

**What is deliberately NOT measured: plans applied.** Applying runs through the
ordinary edit mutations, and teaching them to recognise an AI-authored edit
would put AI-specific code into the exact paths whose innocence is §4.6's best
property. The funnel belongs to the client, which already knows the difference.

Tests: `MetricsEndpointIntegrationTest` asserts three identities (anonymous →
401, ordinary user → 403, admin → 200). The 403 case is the load-bearing one —
a rule downgraded from `hasRole('ADMIN')` to `.authenticated()` still passes an
anonymous-only test while handing every account the app's internals.

---

## 5. Demo video script (~4–6 minutes)

Practical setup: run the app (Docker on 8081 → Supabase, per your `.env`),
open **two different browsers** (not two tabs — you need two logins, e.g.
Chrome + Edge), sign in as two different accounts, and make sure one of them
has `aiAccess`. Rehearse once; the AI call and cooldown are the parts that
can surprise you live.

1. **Cold open on the result** (30s): a finished beat playing in the
   arrangement view. "This is Cotune, a real-time collaborative music editor
   I built with Spring Boot, GraphQL, and React."
2. **Create + build** (60s): new song → add lanes → draw a pattern on the
   grid → hit play. Mention: "the browser synthesizes this with Tone.js —
   the backend only ever stores note data."
3. **Real-time** ⭐ (90s): second browser, second account, same song. Draw
   notes in one, watch them appear in the other; point out the live badge,
   the colored cursors, the flash on remote notes. Say the one-liner: "the
   wire carries deltas, not the whole pattern — that's why two people can't
   overwrite each other."
4. **Roles** (30s): show the VIEWER account unable to edit; show that an
   EDITOR has no share button. "Permissions are decided server-side in one
   class and the client is told its role."
5. **AI beat composer** ⭐ (60s): open the compose dialog, type "sad lofi
   beat", show the **preview of the plan**, then Apply and watch lanes +
   tempo + patterns land. Say: "the AI proposes a plan; it never writes to
   the song — applying goes through the same edit paths as the mouse, so
   undo and the realtime broadcast just work." Optionally flash the
   Handbook tab: "and this tab shows exactly what the model was told."
   (Remember the 10s cooldown between AI calls.)
6. **Arrangement** (30s): place clips, alt+drag to duplicate, resize a beat
   clip to loop it, double-click into the editor.
7. **Share the listen link** (20s): open it in an incognito window — no
   login, song plays.
8. **Close** (20s): "Deployed on Heroku from a single Docker image that
   serves both the React app and the API; Postgres and audio storage on
   Supabase; CI publishes every green build." Show the live URL.

---

## 6. Interview talking points — the "hard problem" stories

These are your best material. Each is a real decision in this repo with a
reason you can defend.

1. **Lost-update problem in collaboration** → deltas + server-side merge
   under `FOR UPDATE`, idempotent ops, diff-based flush. (§4.3)
2. **Presence without server state** → stateless relay, identity from the
   signed token, client-side expiry. Explain *why* a registry is a trap.
3. **Exactly-once across instances** → Redis relay with one delivery path;
   persist-before-publish means a Redis outage loses frames, never work.
4. **AI safety by architecture** → propose-don't-execute, server re-validated
   plans, the model's reach is a subset of the user's own powers, shared
   cooldown across AI endpoints. (§4.6)
5. **Authorization that doesn't drift** → one `SongAccess` authority,
   `myRole` sent to the client, EDITOR ≠ sharer. (§4.1)
6. **Optimistic locking** → `expectedVersion` on mutations; refuse, don't
   clobber.
7. **A real production bug you can narrate**: the `/admin` deep-link 401.
   SPA route worked when *navigating* (React Router, no server round trip)
   but a hard refresh died, because a new frontend route must be registered
   in TWO server-side places (`SecurityConfig` permitAll shell list +
   `SpaForwardingController`). And it 401s, not 403s: the JWT lives in
   localStorage, so a page navigation arrives anonymous → Spring's
   AuthenticationEntryPoint answers "who are you?". Great story: symptom,
   root cause, why the status code was the misleading part.
8. **Deploy war stories** (Heroku container stack): buildpack silently skips
   Lombok's annotation processor (~100 phantom errors) and never runs the
   Node stage; `ENTRYPOINT` gets shell-mangled so `$PORT` dies (fix: CMD +
   `heroku.yml` `run:`); unconstrained JVM heap blows the 512MB dyno quota
   with R14s and the app "stays up" while requests die. All in README §Heroku.

---

## 7. Honest limitations (know these before someone else finds them)

Interviewers respect "here's what I'd do next" far more than pretending
there are no gaps.

- **In-memory rate limits/cooldowns** (`AiGraphqlController`, chat,
  `RateLimitFilter`, `SongAccessCache`) are per-instance maps — documented
  trade-off, "move to Redis when web > 1". Worth naming plainly: the realtime
  layer scales out via the Redis relay and this axis does not, so with two
  dynos a caller gets roughly double the intended rate limit depending on which
  instance the load balancer picks. Known, not hidden.
- **Metrics are exposed but not scraped** — `/actuator/prometheus` is live and
  ADMIN-gated (§4.12), but nothing is collecting or graphing it yet. The next
  step is a hosted Prometheus + Grafana with a service account, at which point
  the k6 baseline becomes a before/after comparison rather than a one-off
  number.
- **No distributed tracing** — metrics tell you *that* p99 moved; with one
  service and no fan-out, tracing would mostly confirm what the metrics say.
  Worth adding the day a second service exists.
- **Non-realtime data doesn't auto-refresh**: song lists, shares, etc. need
  a manual reload; only the beat grid + chat + presence are live. (You
  decided against polling stopgaps — the plan is WebSocket push.)
- **AI is invite-only** — a cost decision, and it means the demo needs a
  pre-flagged account.
- **Single simple broker by default** — multi-instance requires opting into
  `REALTIME_RELAY=redis`.
- **No audio rendering server-side** — export happens in the browser
  (`mp3.ts`); fine for the scope, worth naming as a known boundary.

---

## 8. Resume bullets (pick 3–4, keep numbers you can defend)

- Built a real-time collaborative music editor (Spring Boot, GraphQL,
  React/TypeScript) where concurrent editors merge safely via delta-based
  WebSocket sync (STOMP) with server-side merge under row locks — no
  lost-update clobbering.
- Scaled the realtime layer across backend instances with a Redis pub/sub
  relay designed for exactly-once local delivery; verified with a
  Testcontainers integration test booting two Spring contexts.
- Integrated Gemini function-calling as an AI co-producer that *proposes*
  validated edit plans applied through normal edit paths — preserving undo,
  optimistic locking, and realtime broadcast with zero AI-specific code in
  those systems.
- Designed object-level authorization with a single server-side authority
  (owner/editor/viewer), delivered to clients as `myRole` to prevent
  client-side permission drift.
- Shipped CI/CD: GitHub Actions builds and publishes a self-contained Docker
  image (React baked into the Spring jar) deployed on Heroku's container
  stack with Supabase Postgres + Storage.

---

## 9. Quick self-quiz (if you can answer these, you're ready)

1. Why deltas instead of sending the whole pattern? *(two snapshots, second
   write erases the first's note)*
2. Why does the JWT ride in the STOMP CONNECT frame and not the handshake or
   URL? *(browser WS API can't set headers; URLs leak into logs)*
3. What stops the AI from setting BPM 900? *(server re-validation against
   Song's own bounds — the Gemini schema is shape, not meaning)*
4. Why can't an EDITOR share the song? *(privilege escalation away from the
   owner)*
5. What happens if Redis dies mid-edit? *(in-flight frames lost, work isn't —
   persisted before published)*
6. Why did refreshing `/admin` return 401 and not 403? *(token in
   localStorage → navigation is anonymous → AuthenticationEntryPoint)*
7. Where does the sound come from? *(Tone.js in the browser — the backend
   stores only note events; `frontend/src/audio/engine.ts`)*
8. Why REST for auth when everything else is GraphQL? *(credentials out of
   query logs; real HTTP status codes; URL-level security rules)*
