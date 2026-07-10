# Cotune

Real-time collaborative music editor. Backend: Spring Boot (Java 21), PostgreSQL (local Docker or Supabase), GraphQL + REST auth. Frontend: React + Vite + TypeScript + Tone.js (`frontend/`) — sign in, open a song, and build a 16-step beat in the browser. Redis pub/sub + WebSocket arrive in later sessions.

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

`deleteSong` additionally requires the ADMIN role. Roles are assigned
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
