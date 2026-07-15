# Cotune — Session History

A compacted record of every Claude Code session on this project, from the first commit
(July 9, 2026) to today (July 15, 2026). Dates are local time and match `git log`.
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
