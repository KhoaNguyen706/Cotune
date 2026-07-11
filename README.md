# Cotune

Real-time collaborative music editor. Backend: Spring Boot (Java 21), PostgreSQL (local Docker or Supabase), GraphQL + REST auth. Frontend: React + Vite + TypeScript + Tone.js (`frontend/`) — sign in, open a song, and build a 16-step beat in the browser. Songs can be **shared** with other accounts as editors or viewers (V10), and co-editors **build the same beat in real time** over a WebSocket (session 16). Redis pub/sub — which is what makes that survive more than one backend instance — arrives in a later session.

**Beats are data, not audio**: a pattern is a JSONB array of `{step, pitch, velocity}` events on the track row (see `V4__add_track_pattern.sql` for the modeling rationale); the browser synthesizes all sound with Tone.js. Object storage (e.g. Supabase Storage) only becomes necessary for uploaded samples and exported audio — not for the sequencer.

## Run

**Full backend stack in Docker (one box):**

```bash
docker compose up -d --build
# port 8080 taken by something else? -> COTUNE_PORT=8081 docker compose up -d --build
```

**Dev mode (DB in Docker, app on host — faster edit/restart loop, IDE debugging):**

```bash
docker compose up -d postgres
./mvnw spring-boot:run
```

**Against Supabase instead of local Postgres** (password: Supabase dashboard → Settings → Database):

```bash
# app on host:
SPRING_PROFILES_ACTIVE=supabase SUPABASE_DB_PASSWORD=<password> ./mvnw spring-boot:run
# app in Docker: copy .env.example to .env, uncomment the SPRING_DATASOURCE_* block,
# then docker compose up -d --build   (Flyway migrates the Supabase DB on first boot)
```

**Frontend** (dev server on http://localhost:5173, proxies API calls to the backend):

```bash
cd frontend
npm install
npm run dev                                        # backend on 8080
VITE_PROXY_TARGET=http://localhost:8081 npm run dev  # backend on another port
```

- REST auth: `POST http://localhost:8080/api/auth/{register,login}`, `GET /api/auth/me`
- GraphQL endpoint: `POST http://localhost:8080/graphql`
- GraphiQL IDE (explore the API in the browser): http://localhost:8080/graphiql

## Try it

Since Session 3 the API requires authentication. Auth lives on REST
(credentials stay out of GraphQL query logs; each endpoint gets real HTTP
status codes and URL-level security rules); data lives on GraphQL.
Get a token first:

```bash
curl -s http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "password": "correct-horse-battery", "displayName": "Alice"}'
# -> { "token": "...", "expiresAt": "...", "user": { ... } }   (login: same shape, POST /api/auth/login)
```

Then send the token on every request as a header (in GraphiQL: the "Headers" tab):

```json
{ "Authorization": "Bearer <token from register/login>" }
```

## Sharing & permissions (session 15)

A song has one **owner** (its creator) and any number of **collaborators**
(`song_collaborators`, V10). What you may do is decided server-side and sent
back on every song as `myRole` — clients must branch on that, never on
`ownerId == me`, because an EDITOR can write to a song they don't own:

|            | view | edit music | share | delete |
|------------|------|-----------|-------|--------|
| **OWNER**  | ✓    | ✓         | ✓     | ✓      |
| **EDITOR** | ✓    | ✓         | ✗     | ✗      |
| **VIEWER** | ✓    | ✗         | ✗     | ✗      |

Note where EDITOR stops. An editor who could share could invite further
editors, and access would escalate away from the owner unseen; an editor who
could delete could destroy work they don't own. "Can change the music" and
"can change who gets in" are different powers. The whole rule lives in
`SongAccess` — every child resource (beats, lanes, patterns, clips, audio)
resolves up to its song and delegates there.

```graphql
mutation {                                   # owner only; re-sharing an existing
  shareSong(input: {                         # collaborator UPDATES their role
    songId: "<id>", email: "bob@example.com", role: EDITOR
  }) { userId displayName role }
}
```

`songs` returns **your** library — songs you own plus songs shared with you.
Before V10 it returned every song in the database to every logged-in user;
`GET /api/audio/{id}` was likewise open to any authenticated caller. Both are
now object-level authorized. Legacy songs with no owner (created before V5)
belong to nobody, so they appear in nobody's library and only an ADMIN can
touch them — adopt one with:

```sql
UPDATE songs SET owner_id = (SELECT id FROM users WHERE email = 'you@example.com')
WHERE owner_id IS NULL;
```

## Real-time editing (session 16)

Two people with edit access can build the same beat at the same time. Open a
song in two browsers: notes appear on both grids as they're drawn, and a VIEWER
watches without being able to touch anything. The editor's title bar shows a
**live** badge when the socket is up.

**The transport.** STOMP over a native WebSocket at `/ws`. The handshake is
open, and it has to be — a browser's `WebSocket` constructor cannot set an
`Authorization` header — so the JWT rides in the STOMP `CONNECT` frame and
`StompAuthChannelInterceptor` authenticates it there. An unauthenticated socket
can *open* and can do nothing: SUBSCRIBE is refused, and SEND is refused by
`@PreAuthorize`. (The other common workaround, `?token=...` in the URL, writes
the credential into access logs, proxy logs and browser history.)

```
client --SEND--> /app/songs/{id}/notes   (only this reaches our code)
                     |  @PreAuthorize canEdit → merge → persist
                     v
       <--broadcast-- /topic/songs/{id}  (clients may only SUBSCRIBE; canView)
```
Clients can never publish straight to `/topic`, so every message on the wire has
been authorized, validated, merged and persisted before anyone hears it.

**Deltas, not blobs.** The wire carries `NOTE_ADD` / `NOTE_REMOVE` — *not* the
whole lane. This is the difference between collaboration working and silently
eating people's work: two editors each hold a snapshot from a moment ago, so if
each sends its whole array, the second write erases the other's note simply
because their array never contained it. A delta says what *changed*, so the
server merges it into whatever the lane holds now — including edits it has never
heard of. `TrackServiceImpl.applyNote` takes a `SELECT ... FOR UPDATE` on the
lane and merges by `(step, pitch)`, which is a note's identity.

This is **not** the event log that was deliberately cut earlier: nothing persists
as events, the `pattern` column stays the single source of truth, and the ops
exist only in flight. Both ops are idempotent (ADD upserts, REMOVE tolerates a
missing note), so a client can safely re-send one it isn't sure landed.

Nothing in the editor's mouse code changed. Edits still mark a lane dirty and
flush on a 1s debounce; the flush now *diffs* the lane against the last
server-confirmed state and sends the resulting ops. A note move falls out of that
diff as a REMOVE plus an ADD, which is exactly how the server wants to hear it.
When the socket is down the editor falls back to the whole-pattern GraphQL save,
which still refuses (rather than clobbers) via `expectedVersion`.

**Presence.** You see your collaborators' cursors glide across the grid, labelled
with their name and coloured by a hash of their user id (so Bob is the same green
on everyone's screen, forever, with nothing to remember). A note somebody else
places *flashes* where it lands — the difference between a sync protocol and
company. Their avatars sit in the title bar.

The server keeps **no session registry**: it stamps identity onto each presence
frame and relays it, remembering nothing. Clients heartbeat every 3s and expire a
peer they haven't heard from in 8s. A registry would be mutable state that leaks
an entry every time a laptop lid closes without a clean DISCONNECT — and it would
be *wrong* the moment there are two instances, since each could only see its own
half of the room. Identity is always taken from the signed token, never from the
payload; otherwise anyone could paint a cursor labelled "Alice" onto her
collaborators' screens.

**Not built yet:** the broker is Spring's *simple* in-memory one — correct for a
single instance, and precisely what breaks with two, since a note sent to instance
A never reaches a subscriber on instance B. That is what Redis pub/sub is for, and
the seam is `WebSocketConfig.configureMessageBroker`.

## App-level roles

The app-level ADMIN role is a *different axis* from the per-song roles above
and does not override them: `hasRole('ADMIN')` says what kind of user you are,
not what you own, so an admin still cannot edit or delete someone else's song.
Its only power over songs is the ownerless legacy rows. Roles are assigned
server-side (never via the API — that would be mass assignment); promote a
user by hand, then **re-login** (roles ride inside the token):

```bash
docker exec cotune-postgres psql -U cotune -d cotune \
  -c "UPDATE users SET role = 'ADMIN' WHERE email = 'alice@example.com';"
```

The JWT signing key has a dev-only fallback in application.yml; real
environments must set the `JWT_SECRET` env var (Base64, >= 256 bits).

```graphql
mutation {
  createSong(input: { title: "Midnight Sketch", bpm: 92, timeSignature: "3/4" }) {
    id
    title
    bpm
    version
    createdAt
  }
}
```

```graphql
mutation {
  addTrack(input: { songId: "<id from createSong>", name: "Lead Synth", instrument: SYNTH }) {
    id
    position
    instrument
  }
}
```

```graphql
query {
  songs {
    id
    title
    bpm
    tracks {        # resolved in ONE batched query for all songs (@BatchMapping)
      name
      instrument
      position
    }
  }
}
```

## Architecture (sessions 1–3)

Package-by-feature (`com.cotune.song`, `com.cotune.track`), classic layering inside each feature:

```
GraphQL request
  → SongGraphqlController   (transport adapter: schema field ↔ method, validation)
  → SongService / Impl      (use cases, transaction boundaries)
  → SongRepository          (Spring Data JPA)
  → PostgreSQL              (schema owned by Flyway migrations)

SongMapper translates Entity ↔ DTO at the service boundary;
entities never cross the API surface.
```

Session 15 adds `com.cotune.collab` (song membership) and makes `SongAccess`
the single authority on song permissions — it is the only class that knows the
matrix above, and the client is *told* its role rather than deriving one. That
is a deliberate correction: Session 14's 403 storm came from the UI keeping its
own copy of the edit rule, and the copy drifted.

Session 3 adds stateless JWT auth (`com.cotune.auth`, `com.cotune.user`).
Token issuance is REST (`AuthRestController`, secured by URL rules in
SecurityConfig); the GraphQL surface stays data-only — `/graphql` is open
at the HTTP layer (all operations share one URL, so the URL can't carry
auth rules) and authorization is per-operation via `@PreAuthorize` on the
resolvers. The bearer-token filter validates JWTs on both surfaces and
populates the SecurityContext those checks read.

Schema contract: `src/main/resources/graphql/schema.graphqls`.

## CI/CD & deploying

Every push runs backend tests + the frontend build (`.github/workflows/ci.yml`).
Pushes to `main` additionally publish the production image to
`ghcr.io/khoanguyen706/cotune` (`:latest` + `:<sha>` for rollbacks).

The production image is **self-contained**: a Node stage builds the React app
and bakes it into the jar's `classpath:/static`, so one container serves
frontend + API from one origin (no CORS, no separate static host).
`SpaForwardingController` handles deep-link refreshes — **new frontend routes
must be added there**, or hard refreshes on them 404.

To deploy (e.g. [Render](https://render.com) free tier — Railway/Fly work the
same way):

1. New **Web Service** → connect this GitHub repo → runtime **Docker** (it
   finds the Dockerfile). Port: 8080.
2. Environment variables:
   - `JWT_SECRET` — fresh key: `openssl rand -base64 32` (never the dev one)
   - `SPRING_DATASOURCE_URL` — `jdbc:postgresql://aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require`
   - `SPRING_DATASOURCE_USERNAME` / `SPRING_DATASOURCE_PASSWORD` — Supabase creds
3. (Optional, full CD) copy the service's **deploy hook URL** into the repo
   secret `DEPLOY_HOOK_URL` → every green build on `main` goes live.

Before real users: disable GraphiQL in prod (`spring.graphql.graphiql.enabled`),
and put the app in the same region as the database.
