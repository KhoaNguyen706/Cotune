# Cotune — Session History

A compacted record of every Claude Code session on this project, from the first commit
(July 9, 2026) to today (July 16, 2026). Dates are local time and match `git log`.
Commit hashes refer to `main`.

**What Cotune is:** a web-based collaborative beat maker / music editor — Spring Boot +
GraphQL/REST backend, React + TypeScript + Tailwind + Tone.js frontend, Postgres
(Supabase in prod), deployed as a Docker container on Heroku with real-time
collaboration over WebSocket (Redis relay when scaled to multiple dynos).

---

## July 9 — Bootstrap: Sessions 1–2 (afternoon)

**Asked:** read `prompt.md`, generate the first code, push to GitHub; explain GraphQL
vs REST in this stack; "implement version 2."

**Shipped:**
- `32a1a19` Session 1: Song CRUD vertical slice over GraphQL.
- `a9c21a7` Session 2: `Track` entity (`Song → Track` one-to-many), Flyway V2,
  nested resolution with `@BatchMapping` to kill the N+1 problem.

**Decision:** `Track` points at `Song` but `Song` has no `@OneToMany` collection —
the graph nesting lives in the GraphQL schema, not the JPA model.

## July 9 — Auth to audible beats: Sessions 3–9 (evening)

**Asked:** Spring Security auth, JWT over REST, docker-compose the whole stack,
Supabase Postgres, a basic frontend, then "make it like a real beat maker," ownership
rules, CI/CD against the new GitHub repo (`KhoaNguyen706/Cotune`), a UI design
system, and a fix for "the play button makes no sound."

**Shipped:**
- `8f5179b` Session 3: JWT auth (REST) + role-based authorization over GraphQL.
- `e8f7b94` Session 4: dockerized server, Supabase profile, React frontend.
- `53f72e0` Session 5: beat maker — step patterns stored as JSONB on the track row
  (grid is always read/saved whole; normalize only if real-time collab demands it),
  Tone.js sequencer in the browser. No storage bucket needed yet: beats are data,
  not audio.
- `b3df33f` Session 6: piano-roll editor — notes with pitch and length.
- `1670508` Session 7: ownership — only a song's creator may delete it.
- `2a8c51f`/`2bb9029`/`df6b70d` Session 8: DAW polish, self-contained image, GitHub
  Actions CI/CD; fixed `./mvnw: Permission denied` by marking mvnw executable in the
  git index.
- `c0b7fdd` Session 9: stale-token fix + Tailwind v4 design system (8px grid,
  semantic tokens, small UI kit).
- `7d88b22` Session 9b: audio audibility — the sound was produced but inaudible:
  default kick at C1 (~33 Hz) is below what laptop speakers can reproduce (now C2),
  chords on monophonic synths threw inside the transport callback and silenced later
  tracks (now isolated per-note try/catch).

## July 10 — Run it, rethink the model: Sessions 10–12

**Morning:** resumed and ran the stack in Docker — app on host port **8081**
(`COTUNE_PORT` from `.env`), Postgres healthy on 5432.

**Midday:** the big product brief ("Polyphonic" prompt): build the full single-user
product first, design so real-time collaboration can be added later without a rewrite.
**Decision (durable):** ship coarse GraphQL CRUD mutations, keep `version` columns as
the concurrency hedge, skip the op-log/event-dispatcher machinery. First cut of the
arrangement timeline (V6: `audio_files` + `clips`) was built, then corrected on user
feedback to the **FL Studio pattern model**: Song → **Beats** (named multi-instrument
patterns with lanes) → timeline places whole beats or audio clips.

**Afternoon/evening:**
- `918454e` Session 10: pattern groups (beats), arrangement timeline, audio import,
  REST rename endpoints (`PATCH /api/songs|beats|tracks/{id}` — single-field updates
  don't need the graph; GraphQL keeps reads and the editor's bigger mutations).
- `60b6bf8`–`e0e1998` Sessions 11a–d: song properties, owner-only edits, optimistic
  concurrency, MP3 export; multi-bar beats (1–8 bars); audio bytes moved to disk (V9);
  pattern undo/redo + generated GraphQL types.
- `3dae16f` Session 12: integration tests on Testcontainers, wired into CI — after a
  long fight with docker-java pipe/API-version issues on Windows (pinned api.version).

## July 10–11 — App shell and bug hunt: Sessions 13–14 (late night)

**Asked:** "the UI looks like an MVP, not the app" + a home-page redesign from a
screenshot; then a bug list (403s, 400 on 8 bars, oversized arrange tab).

**Shipped:**
- `915135b`/`8d09655` Session 13: DAW app shell — full-bleed workspace, real transport
  bar; home page with nav rail + waveform song cards.
- `0b8abcb` Session 14: the 403s were the UI offering edits the server would always
  refuse (legacy `ownerId: null` songs; editor never selected `ownerId` so everything
  looked un-owned) — editor now derives `canEdit` mirroring `SongAccess` and renders
  read-only. The 8-bar "400" was the same permissions issue; the real 8-bar problem
  was layout (128 steps), fixed with a shared scroll box + sticky pitch gutter.
  Plus light mode, auto-save, settings.

## July 11 — Real-time collaboration: Sessions 15–18 (morning)

**Asked:** merge and run; "why do I have to restart the website to see the song shared
to me"; add WebSocket real-time beat editing; live cursors/presence; clear-notes
buttons.

**Shipped:**
- `fe61878` Session 15: song sharing — and the read-permission holes it exposed.
- `683d8de` Session 16: real-time collaborative beat editing over WebSocket —
  **deltas on the wire** (per-note ops), not whole-grid saves.
- `8d1cf6b`–`4af6bc1` Session 17: live cursors, presence (incl. channel rack), fixed a
  latency bug and invisible collaborators on other lanes.
- `c1724c6` Session 18: "Clear lane"/"Clear beat" buttons — deliberately frontend-only
  (clears local state, flush diffs to per-note `NOTE_REMOVE` ops, so a collaborator's
  just-added note survives); fixed undo not restoring the dirty set on redo.

## July 12–13 — Deploy: Sessions 19–20

**Asked:** how to deploy (Vercel FE + Heroku BE was the initial idea); then "just do
whatever so I can deploy this app."

**Shipped (July 12 night):** Dockerfile entrypoint now expands Heroku's `$PORT`
(`sh -c "exec java -Dserver.port=${PORT:-8080} …"` — exec keeps java as PID 1 so
SIGTERM works); `heroku.yml` for the container stack. Verified with `PORT=9137` and
without.

**Shipped (July 13):** single-container deploy chosen — Heroku app **cotune**
(container stack) + Supabase for DB and audio storage, always deployed with
`SPRING_PROFILES_ACTIVE=supabase,prod`:
- `50c9420` Sessions 19–20: Redis relay so WebSocket events cross dyno instances;
  made the app deployable.
- `ebfaf8c` Lombok silently skipped on other JDKs → Heroku build broke; fixed.
- `e97225b` Heroku mangled the ENTRYPOINT → silent crash-loop; fixed.
- `f6eeeb4` R14 memory quota — constrained the JVM for a 512 MB dyno.
- Live at https://cotune-9a95dfcd1d79.herokuapp.com/

**Afternoon (same session):**
- `a9854aa` Refactor: the 2,220-line `BeatMakerPage` broken into six hooks.
- `cbc5612` Audit against the original brief found exactly one missing feature:
  clip **duplicate** → alt+drag (the DAW-standard gesture; a drag says *where*,
  a command would have to guess).
- `8129276` `ROADMAP.md`: hardening, measured scaling (k6 first, then vertical, then
  `ps:scale web=2` + `REALTIME_RELAY=redis`), three features, and exactly one AI
  feature — AI pattern generation returning `NoteOp`s through the existing
  validation/merge/relay pipeline.

## July 13 — Hardening + chat: (evening, autonomous roadmap execution)

**Shipped:**
- `b019e1d` Per-IP rate limiting — the BCrypt endpoints were a one-curl DoS.
- `1dada41` Timeline gets the `readOnly` gate every other surface already had.
- `58361ec` `/actuator/health` now checks DB reachability, not just an open port.
- `edda76d` Session lifetime 1h → 12h (decided, not drifted).
- `65397c3` A real browser now gates every push (CI hardening).
- `cda2583` **Chat** — talk about the beat next to the beat (STOMP over the existing
  WebSocket).

## July 14 — AI chat advisor shipped

Finished and verified the in-flight AI-into-chat work from the previous session:
- `cf24399` **@ai in chat** — any chat line starting with `@ai` also asks Claude
  (Anthropic Java SDK, `claude-opus-4-8`, server-side only via `ANTHROPIC_API_KEY`);
  the answer arrives as an ordinary chat message from "Cotune AI" (`authorId` null —
  the deleted-account shape every consumer already handles). `SongDescriber` renders
  the song as x/—/. text grids; replies are clamped to the chat's 1000-char cap
  (added this session — the model is asked for 900 but nothing guaranteed it).
  Keyless deploys degrade to a polite "not configured" reply, pinned by an
  integration test that runs with no Anthropic account.
- `a23a382` **Mobile shell** — nav rail collapses to icons, top bar scrolls
  sideways, sidebar overlays the canvas on phones.
- Verified: full backend suite 116/116 green (Testcontainers), frontend builds.

**To enable in prod:** `heroku config:set ANTHROPIC_API_KEY=... -a cotune`.

**Same session, continued — Phase 3.2 public listen links** (the roadmap's next
item: the growth loop):
- V12 `songs.listen_token` (nullable, partial unique index) — the token IS the
  authorization: 32 random bytes base64url, owner-only mint/revoke via
  `enableListenLink`/`disableListenLink` (canShare gate — publishing decides who
  gets in). Enable is idempotent; revoke + re-enable mints a fresh token.
- Public GraphQL `listen(token)` returns a separate `ListenSong` type family
  (playback-shaped; no emails/roles/filenames can leak by construction — the
  Song type's resolvers all require auth, so reusing it was never an option).
- Public audio bytes: `GET /api/listen/{token}/audio/{id}` (checks the audio
  belongs to the token's song; member route stays locked).
- Frontend: `/listen/:token` player page (reuses the arrangement scheduler via
  new structural `Playable*` types in engine.ts; loops the first non-empty beat
  when the timeline is empty so shared sketches aren't silent), listen-link
  section in ShareModal, `Song.listenToken` owner-only field.
- 6 new integration tests (anonymous read, idempotence, revocation, role
  denials, token visibility, audio-route isolation). Suite 122/122 green,
  frontend builds.

**Same session, continued — AI hardening (user requests):**
- `403f7b1` @ai gates on song membership; model switched to `claude-haiku-4-5`
  (cheapest; ANTHROPIC_MODEL overrides). Haiku rejects adaptive thinking +
  effort params, so the request sends neither — valid on every current model.
- `936739a` **AI is invite-only, invitation from an ADMIN** (V13
  `users.ai_access`): grantAiAccess/revokeAiAccess mutations (ADMIN role),
  second gate in ChatAiBridge, admins always allowed; client reads
  `UserDto.aiAccess` and hides the @ai hint from the uninvited.
  Admin itself became config: `cotune.security.admin-emails` (ADMIN_EMAILS,
  default khoa.nguyen02@sjsu.edu) applied at startup + registration.
  **khoa.nguyen02@sjsu.edu promoted to ADMIN directly in Supabase** (the
  prod + dockerized-dev DB) — takes effect at next login. Suite 133/133.

**Same session, continued — render refactor:**
- `9b827d0` The hooks refactor (`a9854aa`) took the logic out of
  BeatMakerPage; this took the render. The remaining 1,013 lines of JSX were
  four unrelated surfaces sharing one closure, now four components in
  `frontend/src/beatmaker/`: `BeatMakerTopBar`, `BeatBrowserSidebar`,
  `BeatEditorCanvas`, `ClearNotesDialog`. State stays in the page (574 lines:
  selection, mode, hook wiring, keyboard shortcuts, layout). Verified with
  tsc + vite build and the full browser smoke test against a live local
  stack — zero console errors. The push also published the whole
  `8129276`→`9b827d0` backlog to GitHub; the remote had been behind since
  the July 13 roadmap commit.

## July 14 — Roadmap features land: (late night, autonomous roadmap execution)

The three remaining feature items, in roadmap order:

- `703b5c0` **AI pattern generation (Phase 4)** — `generateTrackPattern(trackId,
  prompt)`: the model sees the song as text grids plus the target lane, answers
  through a structured-output schema (malformed JSON is not a failure mode), and
  every note is rebuilt through the same Step constructor a human edit passes —
  what leaves the server is indistinguishable from hand-drawn notes. The server
  saves nothing: the client lands notes as one undoable local edit and the
  existing flush turns them into per-note deltas collaborators watch arrive.
  Gates: track edit rights → admin-granted aiAccess → 10s per-user cooldown;
  keyless deploys answer via a new UNAVAILABLE error category. ✨ Generate
  button in the beat editor for invited editors. Suite 143/143.
- `036c6c0` **Mixer persistence (ROADMAP 3.3)** — V14 puts `volume` (0..1) and
  `pan` (-1..1) on the track row; mute/solo deliberately stay session-local
  (audition tools — persisting them means songs that open silent for no visible
  reason). `PATCH /api/tracks/{id}` grew to the optional-fields shape beats
  already use; the mix rides on Track AND ListenTrack so a listener hears the
  makers' balance. Every synth speaks through a per-lane `Tone.Channel`;
  sliders update audio live mid-drag, PATCH once on release; offline WAV export
  builds instruments with the mix. Suite 146/146.
- `433fe51` **Song version history (ROADMAP 3.1)** — the op-log the early
  sessions deferred arrives as V15 `song_events`: append-only, no FK to tracks
  (a lane's deletion must not erase the record of what happened in it), written
  inside the same transaction as both write paths — deltas as NOTE_ADD/
  NOTE_REMOVE (the remove capturing the note as it was) and whole-grid saves as
  one PATTERN_SET; existing grids enter via a migration baseline. Replay IS
  restore: `trackPatternAt` returns the historical grid and the client lands it
  exactly like AI generation — one undoable local edit, flushed as deltas,
  recorded in history like any other save. The past is read-only. `songHistory`
  (canView) resolves names server-side, where absence is information (null
  trackName = deleted lane = not restorable); 🕘 panel with per-entry Restore.
  Suite 153/153; browser smoke green.

With this, **every feature phase of the roadmap is done** (1, 3.1, 3.2, 3.3, 4).
Phase 2 (scale) remains gated on traffic, by design.

## July 15 — Loose ends, then the measuring instrument ("continue")

Pushed the four-commit backlog (this file included, `9f3f3c7`), then built the
only unstarted roadmap item that needs no traffic to be worth doing — **Phase 2
Step 0, the k6 baseline**:

- `load/baseline.js` — one VU is one musician: register, real `/ws` WebSocket,
  JWT in the STOMP CONNECT frame (same reasoning as socket.ts), subscribe, one
  note op every 2.5s through the real `/app` merge path. VUs group into rooms
  of ROOM_SIZE editors sharing one song, because fan-out is the load. The
  metric is `note_rtt_ms`: SEND → own echo, i.e. auth + validation + merge +
  Postgres commit + broadcast, the latency a human perceives; its p95 < 200ms
  is the threshold, and the VU count that first breaks it is "the number".
  Echoes are matched by (actorId, type, step, pitch) with per-member pitches,
  so a room's concurrent ops can't cross-match. `echo_timeouts` / `op_errors`
  must stay zero for a run to count.
- `load/compose.loadtest.yml` — the safety file: pins the datasource to the
  LOCAL postgres container with hard values (a `.env` pointing the dockerized
  app at Supabase must never leak into a load run) and raises the per-IP rate
  limits the way the integration tests do (all VUs share the runner's IP; prod
  limits would 429 setup at the 11th registration).
- Validated live, twice: smoke (8 VUs — fan-out math exact, 24/24 checks) and
  a 96-editor / 24-room run: **p95 echo RTT 17ms, max 26ms, zero timeouts,
  zero refused ops, 141/141 checks**, 17,243 events ≈ 4,387 ops × 4. A laptop
  doesn't blink at 96 concurrent editors — consistent with the roadmap's read
  that connections, not CPU, will be the bottleneck. The real knee must come
  from a staging-dyno run; what's built is the method.
- Left things as found: k6 users/songs deleted from the local dev DB (it holds
  real dev data from July 10 — targeted deletes, never `down -v`), stack down,
  volumes kept.

## July 15 — AI provider switch: Anthropic → Gemini (same day, user request)

**Asked:** audit the Claude API integration (came back clean, two advisory
notes: the caching comments overstated reality, and no HTTP timeout was set);
how to get an API key; is a key different from a Pro subscription; then the
decision that followed from the economics: "change from anthropic provider to
gemini" — Gemini flash has a free tier.

**Shipped:** the provider swap, contained by design because the AI seam was
always two classes behind `enabled()` gates:

- New `GeminiClient` — plain REST over Spring's `RestClient` (the
  SupabaseAudioStorage house pattern, explicit 5s/60s timeouts — fixing the
  timeout gap the audit found) instead of Google's SDK: two call shapes
  (`generateText`, `generateJson`) don't earn a dependency. JSON shape is
  enforced by Gemini's `responseSchema` constrained decoding; typed failures
  (rate-limited / unusable / API error) let callers pick user-safe words.
- `AiAdvisor` and `PatternGenerator` keep their public seams (`advise()`,
  `generate()`, `enabled()`, exception types) — ChatAiBridge, the GraphQL
  controller, and every test compile untouched. The pattern schema the
  Anthropic SDK derived from records via reflection is now an explicit
  `PATTERN_SCHEMA` constant.
- Config: `GEMINI_API_KEY`/`GEMINI_MODEL` (default `gemini-2.5-flash` — free
  tier, thinking on by default) across application.yml and both compose
  services; `anthropic-java` removed from the pom entirely.
- Verified: suite 153/153 green; live probe against a host-run backend with
  the user's real key — `generateTrackPattern("boom bap...")` returned kicks
  on 0/6/10, snares on 4/12, all through the Step-constructor validation.
  Probe data swept from the local DB afterwards.

**Note:** the user's key was pasted in chat — flagged for rotation. Prod
enablement is now `heroku config:set GEMINI_API_KEY=... -a cotune` (and a
deploy — prod still runs the Anthropic build until then).

**Same session, continued — prod enablement + deploy:**
- Set `GEMINI_API_KEY`/`GEMINI_MODEL` on Heroku (`config:set`). Discovered
  prod had NO `ANTHROPIC_API_KEY` at all — the July 14 enablement was never
  done, so @ai on the live site had been answering "not configured" all
  along. Also found prod was 503-crashed and stuck on `e97225b` (a **July 13**
  build); the config restart cleared the crash.
- Deployed with `git push heroku main` (container stack) — prod jumped
  `e97225b`→`b928948` (release v19). Booted healthy in 13.6s, no R14.
- Verified Gemini LIVE on production: registered a throwaway, promoted it to
  ADMIN in Supabase, and `generateTrackPattern("four on the floor house
  kick with an offbeat clap")` returned a real house pattern — kick (C2) on
  0/4/8/12, clap (D#2) on the offbeats 4/12. Probe data swept after.
- Surfaced during probing: the **Supabase session pooler caps at 15 clients**
  (`EMAXCONNSESSION`) — my psql probes contended with prod's Hikari pool.
  This is exactly the ROADMAP Phase-2 "Hikari × dynos arithmetic" concern,
  seen early. Transient here; worth watching as real traffic arrives.

## July 15 — Admin AI-invite tab (ROADMAP-adjacent, user request)

**Asked:** "add one tab admin i can give people ai feature invite through
email" — a frontend surface for the existing admin-only invite mutations.

**Shipped (frontend-only — the backend already had it):** the
`grantAiAccess(email)`/`revokeAiAccess(email)` mutations (V13, `hasRole
('ADMIN')`, email-keyed) needed no change. Added:
- `frontend/src/pages/AdminPage.tsx` — an admin console (one card for now):
  email field + Grant/Revoke, mapping 404 to "No account found for X". Same
  app shell + nav rail as the songs page.
- `/admin` route gated by a new `requireAdmin` flag on `ProtectedRoute`
  (non-admins bounce to `/`; the server's hasRole is still the only gate).
- An "Admin" nav item on the songs page, rendered only when
  `user.role === "ADMIN"`.
Verified: frontend builds clean (tsc strict); the mutations behind it are
already covered by AiAccessIntegrationTest over real HTTP (part of 153/153)
— non-admin FORBIDDEN, grant/revoke round-trip, unknown-email 404.

---

## July 16 — The beat composer's backend, + a handbook tab ("continue")

**Picked up mid-flight:** an uncommitted `BeatComposer.java` and a
`GeminiClient.generateToolCalls` — the third call shape, and the first where
the model decides WHAT HAPPENS (tool calls) rather than what is said. It did
not compile: `AiAction`, the type the whole design returns, had never been
written.

**Shipped (backend):**
- `AiAction` — a **sealed** interface (SetBpm / AddLane / SetLanePattern /
  ClearLane) with static factories. Sealed on purpose: it makes the mapping
  switch exhaustive, so a fifth tool cannot compile until it is mapped.
  Crossing `FunctionCall` → `AiAction` IS the trust boundary.
- Fixed `beatContext` — it called `beat.getTracks()`, which does not exist
  and shouldn't: entities here never hold child collections. Reused
  `findByBeatIdInOrderByPositionAsc` instead, which also gets ORDER BY
  position for free.
- `composeBeat(beatId, prompt): [AiAction!]!` over GraphQL as a **union**
  (user's call, over a flat `kind` enum + nullable fields): each member
  carries only its own fields, so the schema cannot describe an impossible
  action. First union in the schema.
- Renamed `PatternGraphqlController` → `AiGraphqlController` and put both AI
  mutations behind **one shared gate** (`spendAiTurn`): invite list +
  cooldown are about the PERSON, not the resource. Two controllers would have
  meant two copies of an authorization rule and a cooldown a caller could
  drain at double rate by alternating.

**Found and fixed a latent prod bug:** `/admin` (the July 15 tab) was never
registered in `SpaForwardingController` **or** `SecurityConfig`, so
navigating to it worked while **refreshing it died** in production. Both
lists now carry `/admin` and `/handbook`.

(Corrected later the same session: the symptom is **401, not the 403** first
claimed. Probed against live prod: `/` `/songs` `/login` `/listen/abc` → 200,
while `/admin` → 401, byte-identical to `/nonsense`. It is 401 because the
JWT lives in localStorage — a page navigation never carries it, so every
refresh reaches the server anonymous and Spring hands anonymous denials to
the AuthenticationEntryPoint. Being signed in never mattered.)

**Shipped (frontend):** `/handbook` — a beat-making reference (grid, tempo
ranges by feel, instrument octaves, velocity/length, what reads as sad, and
the rules the server actually enforces). It is the same knowledge in
`BeatComposer.SYSTEM_PROMPT`, surfaced so a human can read what the AI was
told. Nav item on Songs + Admin, `BookIcon` added to the icon set.

**Verified:** suite **181/181 green**. `validate()` has 12 unit tests over the
calls a model really emits (BPM 900, "SAD" as an instrument, "Kick" then
"kick", a pattern for a lane nobody created). The union's member names are
matched to Java classes at RUNTIME by Spring, so two integration tests assert
the schema/record agreement in both directions — javac cannot. Drove
`/handbook` in a real browser (Playwright, registered through the real REST
endpoint): renders, no console errors; **measured** the ASCII grid rows at
120px each to prove the em-dash columns align rather than trusting my eye.
Probe users swept from the local DB.

**Same session, continued — the frontend half + live proof ("complete missing
part"):**
- `types.ts` adds the `AiAction` union **with `__typename`**. Codegen runs
  `skipTypename`, so the generated union is four members with nothing to tell
  them apart — and `ClearLane` ({lane}) is a structural SUBSET of
  `SetLanePattern` ({lane, notes}), so TS would narrow structurally and
  "empty this lane" could pass for "fill it". The discriminant is added in
  types.ts rather than by flipping the global config; fields still derive
  from the generated file.
- `composeInto()` in BeatMakerPage — the apply, and the ORDER IS FORCED:
  structure first (bpm via patchSong, lanes via a new `addLanes` that reloads
  **once**), THEN one `recordHistory()`, THEN all patterns in one setNotes.
  Reason: `load()` resets history and drops unsaved edits, so any notes
  landed before the lane-add would be destroyed by it. One record() for the
  whole plan = one Ctrl+Z, because a snapshot is the entire grid.
- `ComposeBeatDialog` + a beat-level "✨ Compose beat" button that, unlike
  "✨ Generate", does **not** require a selected lane — an empty beat has
  none, which is exactly when you want it.

**Verified LIVE against real Gemini** (local DB + real key): "a sad lofi beat
with brushed drums and a late bass" → `SetBpm 75`, three lanes, kick C2 on
0/8, snare on 4/12, ghost hats alternating 0.2/0.25 velocity, bass starting
on step **1** (late, as asked), pads on C-minor then G-minor triads. Then
drove the whole thing in a browser: BPM 120→75, lanes created, notes landed
**and saved** (read back from the server), no console errors. This was the
first time the union's RUNTIME type resolution had ever been exercised — the
integration tests can only assert the names match.

**Mistake worth recording:** sourcing `.env` to get the key also exports
`SPRING_DATASOURCE_*`, which points the host-run app at **Supabase (prod)** —
a probe user got registered there and had to be deleted. Export
`GEMINI_API_KEY` alone; see the two-databases standing decision below. It
also masked itself: `UPDATE 0` on the local DB was the only clue.

**Same session, continued — the plan preview + a test seam:**

Asked "is everything implemented?" — checked the ROADMAP against the code:
**Phases 1, 3 and 4 are all done** (rate limiting, actuator health, 12h JWT
decision, the timeline canEdit gate and the CI smoke test; version history,
listen links, mixer persistence; AI generation — `composeBeat` exceeds what
Phase 4 scoped). Phase 2 is deliberately "as traffic demands" with the k6
baseline already taken. There is no backlog.

Two things were worth doing anyway:
- **`plan.ts` — the plan-reading rules, extracted and pure.** The preview must
  TELL you what a plan does; the apply must DO it. Two readings of one plan is
  how a preview becomes a lie, so there is now one (`bpmOf`, `lanesToAdd`,
  `notesByLaneId`, `planSummary`, `hasIrreversible`). It is also the only way
  this logic gets tested: `composeInto` is welded to a live-key network call,
  so the decisions moved somewhere a keyless test can reach. **vitest added**
  (15 tests, 160ms) + a CI step — the first frontend unit tests, justified by
  this being the one place a wrong answer is silent AND destructive.
- **The preview.** `composeBeat` was designed "the model proposes, it does not
  execute" — but the client applied the proposal instantly, so the user got
  none of that. Now: prompt → plan → Apply/Discard. It matters because of the
  asymmetry: notes are undoable, the **tempo change and new lanes are not**, so
  the part you cannot take back was also the part you never saw. The warning
  renders only when `hasIrreversible` is true — a notes-only plan really is
  fully undoable, and crying wolf trains the warning away.

**Verified live again:** the preview listed "Set the tempo to 75 BPM · Add a
drums lane · Write 10 notes · Add a bass lane · Write 4 notes", and while it
was on screen a server query answered **bpm 120, lanes 0** — "nothing has
changed yet" proved literally true, not just copy. Apply → bpm 75, both lanes
created, notes saved. No console errors. Probes swept.

**Two real bugs found by asking "what's still wrong?", both in the apply:**
- **A failed tempo change was silent.** `mutate()` catches and does not
  rethrow (right for a lone control — the banner plus an unchanged field IS
  the answer), and `patchSong` uses it. So inside applyPlan a failed set_bpm
  showed a banner and the plan CARRIED ON, composing the beat at the old
  tempo after a preview that promised the new one — the exact lie the preview
  exists to prevent. `mutate` now returns whether it worked (the whole
  mutate-backed family does; callers that don't care ignore it), and applyPlan
  stops before touching anything else.
- **A half-applied plan duplicated lanes on retry.** If addLanes died after
  lane 2 of 3, the dialog kept the plan AND its Apply button, so the retry
  re-added lanes 1-2 — two lanes named "drums" and a pattern landing in a
  coin-flip one of them, which is precisely what BeatComposer.validate refuses
  to do server-side. `lanesToAdd(plan, existingNames)` now filters against
  what the beat holds RIGHT NOW, not what it held when the plan was made.
  Pure, so both are pinned by tests (19 now).

**Not a bug, worth knowing:** previewing spends the 10s cooldown, because
fetching the plan IS the Gemini call. Discard + re-prompt inside the window
gets "One generation at a time". Correct — the cost is already sunk — but the
preview is what makes a discard likely in the first place.

---

## Standing decisions (the ones that keep mattering)

- **GraphQL for reads and editor mutations; REST for auth, audio bytes, and
  single-field renames.**
- **Ship over op dispatcher:** coarse CRUD mutations + `version` columns; no event log.
- **Deltas on the wire** for collab — per-note ops so concurrent edits don't clobber.
- **FL Studio pattern model:** Song → Beats (multi-lane patterns) → timeline clips.
- **Two databases in dev:** dockerized app (8081) talks to Supabase via `.env`;
  host-run app + psql use local `cotune-postgres`. Logins differ between them.
- **Deploy:** Heroku app `cotune`, container stack, `SPRING_PROFILES_ACTIVE=supabase,prod`.
- **No polling stopgaps** — real push (WebSocket) or manual reload, never interval
  refetch.
