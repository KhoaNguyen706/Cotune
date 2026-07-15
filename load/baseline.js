/**
 * ROADMAP Phase 2, Step 0 — the baseline. "A k6 script that simulates N
 * concurrent editors (connect socket, subscribe, send note ops at human
 * speed) against a staging app. Find the number where p95 latency degrades.
 * Everything after this step is driven by that number, not by vibes."
 *
 * WHAT ONE VU IS: one musician with a song open. It logs in, opens the
 * song's WebSocket, subscribes like the real client (socket.ts), and edits
 * at human speed — one note op every OP_INTERVAL_MS. VUs are grouped into
 * rooms of ROOM_SIZE editors sharing one song, because fan-out is the load:
 * every op a room member sends is broadcast to the whole room.
 *
 * THE NUMBER THIS PRODUCES: note_rtt_ms — the time from SENDing an op to
 * receiving one's own echo on the song topic. That echo has crossed the
 * entire authoritative path: STOMP inbound channel, auth, validation, the
 * TrackService merge (lock, version bump), the Postgres commit, the
 * broadcaster (and Redis, when the relay is on), and the fan-out back.
 * It is the collaborative-editing latency a human perceives, which makes
 * its p95 the roadmap's degradation criterion.
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO: talk to Anthropic (costs
 * money), upload audio (bandwidth test, different bottleneck), or bypass
 * validation (every op goes through /app like a human's — an op the server
 * would refuse from a browser is refused here too and lands on
 * /user/queue/errors, counted as op_errors).
 *
 * See load/README.md for how to run it and how to read the result.
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, fail } from "k6";
import { Trend, Counter } from "k6/metrics";

/* ---------- knobs (all overridable: k6 run -e VUS=100 ...) ---------- */

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const WS_URL = BASE_URL.replace(/^http/, "ws") + "/ws";
const VUS = parseInt(__ENV.VUS || "16", 10);
const DURATION_S = parseInt(__ENV.DURATION_S || "120", 10);
const RAMP_S = parseInt(__ENV.RAMP_S || "30", 10);
// 12 distinct pitches exist below, and each editor in a room needs its own
// (it is how an echo is matched back to its send) — hence the cap.
const ROOM_SIZE = Math.min(parseInt(__ENV.ROOM_SIZE || "4", 10), 12);
// ~2.5s between ops is a busy editor: drawing a hi-hat line, not idling.
const OP_INTERVAL_MS = parseInt(__ENV.OP_INTERVAL_MS || "2500", 10);
// An echo slower than this is counted lost, not just slow — past the point
// where a collaborator would say "it's broken", and past any p95 we accept.
const ECHO_TIMEOUT_MS = 5000;

/* ---------- metrics ---------- */

const noteRtt = new Trend("note_rtt_ms", true);
const notesSent = new Counter("notes_sent");
const eventsSeen = new Counter("events_seen"); // fan-out arriving (everyone's ops)
const echoTimeouts = new Counter("echo_timeouts");
const opErrors = new Counter("op_errors"); // server refused an op (/user/queue/errors)

export const options = {
  // Setup registers VUS users and builds the rooms over plain HTTP; BCrypt
  // is ~100ms per registration by design, so give big runs room.
  setupTimeout: "15m",
  scenarios: {
    editors: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: `${RAMP_S}s`, target: VUS },
        { duration: `${DURATION_S}s`, target: VUS },
      ],
      gracefulStop: "15s",
    },
  },
  thresholds: {
    // The roadmap's criterion. 200ms is the starting SLO: above it,
    // collaborative editing stops feeling live. The run that first breaks
    // this threshold is the knee — that VU count is "the number".
    note_rtt_ms: ["p(95)<200"],
    echo_timeouts: ["count<1"],
    op_errors: ["count<1"],
    checks: ["rate>0.99"],
  },
};

/* ---------- minimal STOMP (what @stomp/stompjs does, spelled out) ---------- */

function stompFrame(command, headers, body = "") {
  let out = command + "\n";
  for (const [k, v] of Object.entries(headers)) out += `${k}:${v}\n`;
  // All bodies here are ASCII JSON, so chars == bytes and this length is
  // honest. Non-ASCII would need real byte counting.
  if (body) out += `content-length:${body.length}\n`;
  return out + "\n" + body + "\u0000";
}

function parseFrames(raw) {
  const frames = [];
  if (typeof raw !== "string") return frames;
  for (const chunk of raw.split("\u0000")) {
    const text = chunk.replace(/^\n+/, ""); // leading LFs = heartbeats
    if (text === "") continue;
    const headerEnd = text.indexOf("\n\n");
    if (headerEnd < 0) continue;
    const lines = text.slice(0, headerEnd).split("\n");
    const headers = {};
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(":");
      if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1);
    }
    frames.push({ command: lines[0], headers, body: text.slice(headerEnd + 2) });
  }
  return frames;
}

/* ---------- setup: build the rooms over REST + GraphQL ---------- */

const JSON_HEADERS = { "Content-Type": "application/json" };

function gql(token, query, variables) {
  const res = http.post(`${BASE_URL}/graphql`, JSON.stringify({ query, variables }), {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
  });
  const body = res.json();
  if (res.status !== 200 || (body && body.errors)) {
    fail(`GraphQL failed (${res.status}): ${res.body}`);
  }
  return body.data;
}

const PITCHES = ["C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4"];

export function setup() {
  // Unique per run so reruns never collide on the email unique constraint.
  const runId = Date.now().toString(36);
  const rooms = Math.ceil(VUS / ROOM_SIZE);
  const vus = [];

  for (let r = 0; r < rooms; r++) {
    const count = Math.min(ROOM_SIZE, VUS - r * ROOM_SIZE);
    const members = [];
    for (let m = 0; m < count; m++) {
      const email = `k6-${runId}-r${r}m${m}@load.test`;
      const res = http.post(
        `${BASE_URL}/api/auth/register`,
        JSON.stringify({ email, password: "k6-load-test-pw", displayName: `k6 r${r}m${m}` }),
        { headers: JSON_HEADERS },
      );
      if (res.status === 429) {
        fail(
          "auth rate limit hit: every VU shares this machine's IP, so the target " +
            "must run with raised limits — see load/README.md (compose.loadtest.yml)",
        );
      }
      if (res.status !== 201) fail(`register failed (${res.status}): ${res.body}`);
      const body = res.json();
      members.push({ token: body.token, userId: body.user.id, email });
    }

    // The first member owns the room's song; everyone else is an EDITOR —
    // the same sharing path (by email) a human uses.
    const owner = members[0];
    const song = gql(
      owner.token,
      "mutation($i: CreateSongInput!){ createSong(input:$i){ id } }",
      { i: { title: `k6 room ${r} (${runId})`, bpm: 120, timeSignature: "4/4" } },
    ).createSong;
    const beat = gql(
      owner.token,
      "mutation($i: AddBeatInput!){ addBeat(input:$i){ id } }",
      { i: { songId: song.id, name: "k6 beat" } },
    ).addBeat;
    const track = gql(
      owner.token,
      "mutation($i: AddTrackInput!){ addTrack(input:$i){ id } }",
      { i: { beatId: beat.id, name: "k6 lane", instrument: "DRUMS" } },
    ).addTrack;
    for (let m = 1; m < count; m++) {
      gql(
        owner.token,
        "mutation($i: ShareSongInput!){ shareSong(input:$i){ role } }",
        { i: { songId: song.id, email: members[m].email, role: "EDITOR" } },
      );
    }

    members.forEach((member, m) =>
      vus.push({ ...member, songId: song.id, trackId: track.id, pitch: PITCHES[m] }),
    );
  }

  return { vus };
}

/* ---------- one VU = one musician with the song open ---------- */

export default function (data) {
  const me = data.vus[(__VU - 1) % data.vus.length];
  let stompConnected = false;
  let opsSeen = 0;

  const res = ws.connect(WS_URL, {}, (socket) => {
    // key "TYPE|step|pitch" -> Date.now() at SEND. (step, pitch) is the
    // note identity the server merges on; pitch is unique per room member,
    // so an echo with my actorId and my pitch can only be my own op.
    const pending = {};
    let step = (__VU * 7) % 16; // spread rooms' writes across the grid
    let adding = true;

    socket.on("open", () => {
      // Token in the CONNECT frame, not the URL — same reasoning as the
      // real client (socket.ts): headers can't be set on a browser
      // WebSocket, and ?token= leaks into access logs.
      socket.send(
        stompFrame("CONNECT", {
          "accept-version": "1.2",
          host: "cotune",
          "heart-beat": "20000,20000",
          Authorization: `Bearer ${me.token}`,
        }),
      );
    });

    socket.on("message", (raw) => {
      for (const frame of parseFrames(raw)) {
        if (frame.command === "CONNECTED") {
          stompConnected = true;
          socket.send(
            stompFrame("SUBSCRIBE", { id: "sub-notes", destination: `/topic/songs/${me.songId}` }),
          );
          socket.send(
            stompFrame("SUBSCRIBE", { id: "sub-errors", destination: "/user/queue/errors" }),
          );

          // The edit loop: ADD then REMOVE the same note, then move one
          // step right. The grid stays clean, both op types get exercised,
          // and there is at most one in-flight op per key.
          socket.setInterval(() => {
            const type = adding ? "ADD" : "REMOVE";
            const op = {
              type,
              trackId: me.trackId,
              step,
              pitch: me.pitch,
              velocity: 0.8,
              length: 1,
            };
            pending[`${type}|${step}|${me.pitch}`] = Date.now();
            socket.send(
              stompFrame(
                "SEND",
                {
                  destination: `/app/songs/${me.songId}/notes`,
                  "content-type": "application/json",
                },
                JSON.stringify(op),
              ),
            );
            notesSent.add(1);
            if (!adding) step = (step + 1) % 16;
            adding = !adding;

            // Sweep: a send with no echo after ECHO_TIMEOUT_MS is lost.
            const deadline = Date.now() - ECHO_TIMEOUT_MS;
            for (const [key, sentAt] of Object.entries(pending)) {
              if (sentAt < deadline) {
                echoTimeouts.add(1);
                delete pending[key];
              }
            }
          }, OP_INTERVAL_MS);
        } else if (frame.command === "MESSAGE") {
          if (frame.headers.destination === `/topic/songs/${me.songId}`) {
            eventsSeen.add(1);
            opsSeen++;
            const event = JSON.parse(frame.body);
            if (event.actorId === me.userId) {
              const key = `${event.type}|${event.step}|${event.pitch}`;
              if (pending[key] !== undefined) {
                noteRtt.add(Date.now() - pending[key]);
                delete pending[key];
              }
            }
          } else if (frame.headers.destination === "/user/queue/errors") {
            opErrors.add(1);
          }
        } else if (frame.command === "ERROR") {
          // Server refused CONNECT or SUBSCRIBE — terminal for the session.
          socket.close();
        }
      }
    });

    // STOMP heartbeat: any data counts, a lone LF is the canonical beat.
    // 15s comfortably beats the negotiated 25s window even when idle.
    socket.setInterval(() => socket.send("\n"), 15_000);

    // Hold the socket for the whole test; the scenario's end cuts stragglers.
    socket.setTimeout(() => socket.close(), (RAMP_S + DURATION_S) * 1000);
  });

  check(res, { "websocket handshake 101": (r) => r && r.status === 101 });
  check(null, {
    "stomp session established": () => stompConnected,
    "saw room traffic": () => opsSeen > 0,
  });
}
