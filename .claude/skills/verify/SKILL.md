---
name: verify
description: Build, launch, and drive the Cotune backend to verify changes end-to-end against the real REST + GraphQL endpoints.
---

# Verifying Cotune backend changes

## Launch

Two modes (start Docker Desktop first if the API is down):

```bash
# Full stack in containers (verifies Dockerfile + compose wiring too):
COTUNE_PORT=8081 docker compose up -d --build   # first build ~minutes (Maven deps)

# Hybrid dev mode (faster when only Java changed):
docker compose up -d postgres
SERVER_PORT=8081 ./mvnw spring-boot:run          # background; wait for "Started CotuneApplication"
```

Gotchas:
- Port 8080 is often taken by unrelated containers that auto-start with
  Docker Desktop (e.g. fitlens-app-1) — hence 8081 above.
- Flyway migrates on startup; a bad migration fails the boot — check
  `docker logs cotune-app` or the mvnw output.

## Drive

**Auth is REST** (`/api/auth/*`), **data is GraphQL** (`POST /graphql`,
body `{"query": "..."}`).

```bash
# token (register once per fresh DB; login thereafter) — jq-free extraction:
TOKEN=$(curl -s localhost:8081/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}' \
  | sed 's/.*"token":"\([^"]*\)".*/\1/')

curl -s localhost:8081/graphql -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"query":"{ songs { id title } }"}'
```

register/login are the only public endpoints; everything else needs the
header; `deleteSong` needs ADMIN (promote via
`docker exec cotune-postgres psql -U cotune -d cotune -c "UPDATE users SET role='ADMIN' WHERE email='...'"`,
then re-login — roles are baked into the token).

## Frontend (frontend/)

```bash
cd frontend && npm run build        # tsc strict + vite build = the compile gate
VITE_PROXY_TARGET=http://localhost:8081 npm run dev   # background
# then drive THROUGH the proxy (the browser's exact path):
curl -s localhost:5173/api/auth/login ...   # REST via vite proxy
curl -s localhost:5173/graphql ...          # GraphQL via vite proxy
curl -s localhost:5173/register | grep src/main.tsx   # SPA fallback serves the shell
```

Supabase mode can't be verified without SUPABASE_DB_PASSWORD (user-held secret).

## Flows worth driving

- REST: register → 201; duplicate email → 409 problem+json; bad password → 401
  with the fixed "Invalid email or password"; validation garbage → 400 with
  field errors; GET /api/auth/me with token → 200
- GraphQL: anonymous query → UNAUTHORIZED in `errors` (HTTP still 200);
  tampered token → HTTP 401 (filter rejects before GraphQL);
  deleteSong as USER → FORBIDDEN
- Beat patterns: `updateTrackPattern(id, pattern: [{step, pitch, velocity}])`
  → round-trips through the tracks.pattern JSONB column; invalid pitch/step
  → BAD_REQUEST with field path; browser audio (Tone.js) can only be
  checked by ear at localhost:5173 — not headless-verifiable here
