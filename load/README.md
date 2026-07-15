# Load baseline — ROADMAP Phase 2, Step 0

> **Step 0 — baseline before changing anything.** A k6 script that simulates
> N concurrent editors (connect socket, subscribe, send note ops at human
> speed) against a staging app. Find the number where p95 latency degrades.
> Everything after this step is driven by that number, not by vibes.

`baseline.js` is that script. One VU is one musician with a song open: it
registers, opens the real WebSocket (`/ws`), authenticates the way the real
client does (JWT in the STOMP CONNECT frame), subscribes to its song's topic,
and sends one note op every ~2.5s. VUs are grouped into **rooms** of
`ROOM_SIZE` editors sharing one song — fan-out is the load profile, so each
op is broadcast to the whole room.

**The number it produces is `note_rtt_ms`:** SEND an op → receive your own
echo on the song topic. That echo crossed the full authoritative path —
STOMP inbound, auth, the TrackService merge (lock, validation, version bump),
the Postgres commit, the broadcaster (plus Redis when the relay spans
instances), and the fan-out back. Its p95 is the number a human experiences
as "is this live or laggy".

## Run the target

**Never point this at the production app or the Supabase database.** The
setup phase creates real users and songs, and this repo's `.env` routinely
points the dockerized app at Supabase. The override file pins the datasource
back to the disposable local Postgres container and raises the per-IP rate
limits (every VU shares your machine's IP; prod limits would 429 setup at the
11th registration):

```sh
docker compose -f docker-compose.yml -f load/compose.loadtest.yml up --build -d
```

The app listens on `http://localhost:${COTUNE_PORT:-8080}`. For the
two-instance Redis-relay path, add `--profile cluster` (second app on
`:8082`) — the override pins both instances.

Cleanup when done (`-v` drops the local DB volume, which is the point):

```sh
docker compose -f docker-compose.yml -f load/compose.loadtest.yml down -v
```

## Run the test

With a local k6 ([install](https://grafana.com/docs/k6/latest/set-up/install-k6/)):

```sh
k6 run -e BASE_URL=http://localhost:8080 -e VUS=50 load/baseline.js
```

Or without installing anything, k6 in Docker (note `host.docker.internal` —
`localhost` inside the k6 container is the k6 container):

```sh
docker run --rm -i grafana/k6 run -e BASE_URL=http://host.docker.internal:8080 -e VUS=50 - < load/baseline.js
```

### Knobs

| env | default | meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:8080` | target app (http/https; ws url is derived) |
| `VUS` | `16` | concurrent editors at the plateau |
| `DURATION_S` | `120` | seconds to hold the plateau |
| `RAMP_S` | `30` | seconds to ramp from 0 to `VUS` |
| `ROOM_SIZE` | `4` | editors per shared song (max 12) |
| `OP_INTERVAL_MS` | `2500` | ms between one editor's note ops |

## Find the knee

Run the same test at increasing scale and watch `note_rtt_ms p(95)` in the
summary. The first VU count where it crosses **200ms** (the threshold in the
script — above that, collaboration stops feeling live) is *the number*:

```sh
for n in 25 50 100 200; do
  k6 run -e VUS=$n -e BASE_URL=http://localhost:8080 load/baseline.js
done
```

Sanity gates that must stay clean for a run to count: `echo_timeouts == 0`
(no op ever went unanswered for 5s), `op_errors == 0` (the server never
refused an op — a refusal means the script or setup is wrong, not the
server), `checks > 99%` (handshakes and STOMP sessions succeeded).

**A laptop baseline is not a dyno baseline.** A local run validates the
script and shows the *shape* of degradation (and whether it's CPU, the
Hikari pool, or the broker), but the number that drives Phase 2 Step 1
(dyno sizing) must come from a run against a staging Heroku app of the same
size as prod. What transfers is the method, not the milliseconds.

## Reading failures

- **Setup fails with 429** — the target is running production rate limits;
  you forgot the override file.
- **`stomp session established` check fails** — usually a dead/expired token
  (server restarted mid-run and the JWT secret is per-boot in dev) or the
  target isn't the app you think it is.
- **`echo_timeouts` climbing while p95 looks fine** — the server is dropping
  or serializing broadcasts; the mean lies, the timeouts don't. This is
  degradation even if the threshold passes.
- **RTTs fine but `events_seen` far below `notes_sent × ROOM_SIZE`** —
  fan-out is failing: with one instance that's the simple broker choking; in
  cluster mode, look at the Redis relay first.
