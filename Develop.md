You are a senior product engineer. I'm building Polyphonic, a web-based
music editor. My plan: build the full SINGLE-USER product first, then
add real-time collaboration as a later phase. Design accordingly — the
single-user architecture must not paint me into a corner when I add
collaboration later.

Do not ask clarifying questions. Make reasonable assumptions and list
them under "Assumptions" at the top of your response.

=== SCOPE FOR THIS PHASE (SINGLE-USER MVP) ===

All features must work end-to-end for one logged-in user. No real-time
sync, no WebSockets, no presence — just a solid single-user DAW.

Auth:
  - Email + password signup and login (JWT).

Beat editor (Level 1):
  - Create, edit, save, delete beats.
  - A beat is a step-sequencer pattern with configurable BPM, bar count,
    and one or more instrument lanes.
  - Playback in the browser via Tone.js.

Track / Song editor (Level 2):
  - Create, edit, save, delete tracks.
  - Add multiple beats onto a timeline, with position and repeat count.
  - Reorder, move, duplicate, delete clips on the timeline
    (video-editor-style clip manipulation).
  - Playback of the full arrangement in the browser.

Audio import:
  - Upload wav/mp3 files, store them, place them as clips on the track
    timeline alongside beat clips.

Audio export:
  - Export/download the finished track as a single wav or mp3 file.

=== FUTURE PHASE (DESIGN FOR, DON'T BUILD) ===

Later I will add real-time collaboration: multiple users editing the
same beat or track simultaneously, WebSocket sync, Redis pub/sub relay
across backend instances, server-authoritative op ordering, per-project
event log.

Your design for the single-user phase must NOT block this. Specifically:

  - State changes should be modeled as discrete OPERATIONS (add note,
    move clip, change BPM) even in single-user mode — not as "PUT the
    whole beat blob." This way the same op format can later flow over
    WebSocket.
  - Every op should carry enough info to be applied deterministically
    on top of a known base state.
  - The persistence layer should be able to accommodate an append-only
    event log later, without a schema rewrite.

Call out any other design decisions where "single-user now, collab
later" changes the right answer vs. building single-user in isolation.

=== WHAT I WANT FROM YOU ===

Structure your response in these sections, in this order:

1. Assumptions
   Every assumption you made about scope, UX, or tech.

2. Data model
   Postgres schema (tables + key columns + foreign keys) for User,
   Beat, BeatLane, BeatStep, Track, TrackClip, AudioAsset, and an
   optional Operation table if you'd add one now to prepare for the
   event log later. One sentence per table on why it exists.

3. Backend API surface (single-user phase)
   Every REST endpoint (method + path + purpose). No WebSocket yet.
   For each mutating endpoint, show the request body as an OPERATION
   (e.g. { "type": "NOTE_ADD", "payload": {...} }) rather than a raw
   PUT of the full resource — explain why once at the top.

4. Frontend UX flow
   The two main screens (Beat Editor, Track Editor) described in prose:
   what the user sees, what they can drag / click / drop, how the two
   screens connect. No pixel-level UI.

5. Audio export strategy
   Client-side (Tone.js OfflineAudioContext) vs. server-side rendering.
   Pick ONE for the MVP, defend it, and note whether the choice changes
   once collaboration is added later.

6. What the "design for later collab" decision costs me now
   List every place where designing for future collaboration makes the
   single-user code more complex than it would otherwise be. Be honest —
   if the extra complexity isn't worth it for some specific piece, say
   "just build the simple version, refactor later" and explain when.

7. Cut list
   3–5 features from the spec above I should CUT or defer even from
   the single-user MVP. Be ruthless.

8. Build order
   Ordered milestones from empty repo to shippable single-user MVP,
   one line per milestone, each with a one-sentence "definition of
   done."

Be direct and opinionated.
