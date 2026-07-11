import { Client, type IMessage } from "@stomp/stompjs";
import { loadSession } from "../api/client";
import type { Step } from "../types";

/**
 * The real-time channel for one song.
 *
 * Everything here is deliberately dumb: connect, subscribe, send ops, hand
 * incoming events to a callback. It holds no editor state and makes no merge
 * decisions — the SERVER is authoritative, and a client that tried to be clever
 * about ordering or conflicts would just be a second, disagreeing implementation
 * of rules that already exist on the other side of the wire.
 */

export type NoteOpType = "ADD" | "REMOVE";

/** What we send: one note delta, not the whole lane. */
export interface NoteOp {
  type: NoteOpType;
  trackId: string;
  step: number;
  pitch: string;
  velocity: number;
  length: number;
}

/** What we receive: the op the server actually APPLIED, plus the lane's new
 *  version and who did it. */
export interface NoteEvent extends NoteOp {
  songId: string;
  version: number;
  actorId: string;
}

export interface SongSocket {
  send(op: NoteOp): void;
  /** Are we actually connected right now? The editor falls back to the HTTP
   *  whole-pattern save when we aren't, so this must tell the truth. */
  connected(): boolean;
  close(): void;
}

/**
 * Open a socket for one song.
 *
 * The token goes in the STOMP CONNECT frame's headers, NOT in the URL. A
 * browser's WebSocket constructor cannot set HTTP headers, so the usual
 * Authorization header is unavailable at handshake time — and the tempting
 * workaround, `?token=...`, writes the credential into access logs, proxy logs
 * and browser history. STOMP frames carry their own headers, so the token rides
 * one frame later, on a socket that can do nothing until it arrives.
 */
export function connectToSong(
  songId: string,
  handlers: {
    onNote: (event: NoteEvent) => void;
    onError?: (message: string) => void;
    onStatus?: (connected: boolean) => void;
  },
): SongSocket {
  const session = loadSession();
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

  const client = new Client({
    brokerURL: url,
    connectHeaders: session ? { Authorization: `Bearer ${session.token}` } : {},
    // Survives a laptop lid, a tunnel, a backend restart. Note what happens on
    // reconnect: we re-SUBSCRIBE but do NOT replay anything we may have sent
    // and lost — the editor re-diffs against the server's confirmed state, so a
    // dropped op is re-derived rather than remembered. Replay queues are how
    // clients end up duplicating other people's work.
    reconnectDelay: 2000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
  });

  client.onConnect = () => {
    client.subscribe(`/topic/songs/${songId}`, (frame: IMessage) => {
      handlers.onNote(JSON.parse(frame.body) as NoteEvent);
    });
    // Our own private queue. Without it, a refused op fails SILENTLY: the note
    // stays on screen, the server never stored it, and the two disagree until
    // the next reload.
    client.subscribe("/user/queue/errors", (frame: IMessage) => {
      handlers.onError?.((JSON.parse(frame.body) as { message: string }).message);
    });
    handlers.onStatus?.(true);
  };

  client.onWebSocketClose = () => handlers.onStatus?.(false);
  // A STOMP ERROR frame means the server refused the CONNECT or a SUBSCRIBE —
  // a dead token, or a song we may not see. It is terminal for this session.
  client.onStompError = (frame) => {
    handlers.onStatus?.(false);
    handlers.onError?.(frame.headers["message"] ?? "Realtime connection refused");
  };

  client.activate();

  return {
    send(op: NoteOp) {
      if (!client.connected) return; // caller checks connected() first
      client.publish({
        destination: `/app/songs/${songId}/notes`,
        body: JSON.stringify(op),
      });
    },
    connected: () => client.connected,
    close: () => void client.deactivate(),
  };
}

/**
 * Turn "what the lane looked like when the server last confirmed it" plus "what
 * it looks like now" into the ops that get from one to the other.
 *
 * THIS FUNCTION IS WHY NONE OF THE EDITOR'S MOUSE CODE HAD TO CHANGE. Drag,
 * resize, right-click-delete, undo, redo — they all just mutate local state as
 * they always did, and the diff run afterwards recovers the ops. Instrumenting
 * every gesture to emit its own op would have meant touching a dozen handlers
 * and getting each one right.
 *
 * A note's identity is (step, pitch) — the same key the server merges on and the
 * same key the entity forbids duplicates of. So a MOVE naturally decomposes into
 * a REMOVE of the old key and an ADD of the new one, which is exactly how the
 * server wants to hear about it.
 */
export function diffNotes(trackId: string, before: Step[], after: Step[]): NoteOp[] {
  const key = (note: Step) => `${note.step}|${note.pitch}`;
  const previous = new Map(before.map((note) => [key(note), note]));
  const current = new Map(after.map((note) => [key(note), note]));
  const ops: NoteOp[] = [];

  for (const [id, note] of current) {
    const was = previous.get(id);
    // Absent before, or the same key with a new velocity/length: both are an
    // ADD, because ADD is an upsert server-side. One op type, two cases.
    if (!was || was.velocity !== note.velocity || was.length !== note.length) {
      ops.push({
        type: "ADD",
        trackId,
        step: note.step,
        pitch: note.pitch,
        velocity: note.velocity,
        length: note.length,
      });
    }
  }

  for (const [id, note] of previous) {
    if (!current.has(id)) {
      ops.push({ type: "REMOVE", trackId, step: note.step, pitch: note.pitch, velocity: 0, length: 0 });
    }
  }

  return ops;
}

/** Apply one incoming event to a lane, with the same merge rule the server
 *  uses — remove the (step, pitch) key, then re-add it if this was an ADD. */
export function applyNoteEvent(notes: Step[], event: NoteEvent): Step[] {
  const without = notes.filter(
    (note) => !(note.step === event.step && note.pitch === event.pitch),
  );
  if (event.type === "REMOVE") return without;
  return [
    ...without,
    { step: event.step, pitch: event.pitch, velocity: event.velocity, length: event.length },
  ];
}
