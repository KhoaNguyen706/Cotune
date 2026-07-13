import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyNoteEvent,
  connectToSong,
  HEARTBEAT_MS,
  PEER_TIMEOUT_MS,
  type NoteEvent,
  type NoteOp,
  type Peer,
  type PresenceEvent,
  type PresenceInput,
  type SongSocket,
} from "../realtime/socket";
import type { Step } from "../types";
import { CURSOR_THROTTLE_MS } from "./constants";

/** Where we are pointing. `row` is optional because the channel rack has no
 *  pitch axis and has nothing to say about it — see reportCursor. */
export interface CursorPosition {
  beatId: string | null;
  trackId: string | null;
  step: number;
  row?: number;
}

export interface Realtime {
  /** Is the channel actually up? Drives the badge, and decides whether edits
   *  leave as deltas or as a whole-pattern HTTP save. */
  live: boolean;
  /** Everyone else in this song right now, keyed by user id. Built entirely
   *  from the presence stream — the server keeps no such list. */
  peers: Record<string, Peer>;
  /** Notes that just arrived from someone else, for the landing flash. Keyed
   *  "trackId:step:pitch" so a note is only ever flashing once. */
  flashing: Set<string>;
  /** Throttled cursor broadcast. Safe to call on every mousemove. */
  reportCursor: (at: CursorPosition) => void;
  /** True when ops can go out as deltas rather than a whole-pattern save. */
  connected: () => boolean;
  sendOps: (ops: NoteOp[]) => void;
}

/**
 * The real-time channel: the socket, presence, and everybody else's cursors.
 *
 * Extracted whole from BeatMakerPage — every comment below describes a bug that
 * was actually shipped and then fixed, which is why they travel with the code.
 */
export function useRealtime(params: {
  songId: string | undefined;
  /** The song's id once loaded — NOT the song object. See the effect below. */
  loadedSongId: string | undefined;
  userId: string | undefined;
  setNotes: React.Dispatch<React.SetStateAction<Record<string, Step[]>>>;
  serverNotesRef: React.MutableRefObject<Record<string, Step[]>>;
  trackVersionsRef: React.MutableRefObject<Map<string, number>>;
  onError: (message: string) => void;
}): Realtime {
  const { songId, loadedSongId, userId, setNotes, serverNotesRef, trackVersionsRef, onError } = params;

  const [live, setLive] = useState(false);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [flashing, setFlashing] = useState<Set<string>>(new Set());

  const socketRef = useRef<SongSocket | null>(null);
  // Our own last cursor position. A ref, because the heartbeat interval is
  // created once and would otherwise re-send whatever position was current when
  // it was created, forever.
  const cursorRef = useRef<PresenceInput>({
    kind: "CURSOR",
    beatId: null,
    trackId: null,
    step: 0,
    row: 0,
  });
  const lastSentRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  /**
   * Somebody (possibly us) changed a note.
   *
   * The two updates below look almost identical and are doing completely
   * different jobs:
   *
   *   serverNotesRef — ALWAYS updated. It is our picture of the server, and the
   *     server just told us what it holds. Skipping our own echo here would
   *     leave the baseline stale, and the next diff would re-send an op we
   *     already landed.
   *
   *   the rendered grid — updated only for OTHER people's ops. Ours is already
   *     on screen; re-applying our own echo would resurrect a stale note.
   *     Concretely: add a note, drag it one step right, and then your own ADD
   *     (for the ORIGINAL position, sent before the drag) arrives — apply it and
   *     you now have two notes, one of which you deliberately moved away from.
   *     Silent, and maddening to debug.
   */
  const onNote = useCallback(
    (event: NoteEvent) => {
      trackVersionsRef.current.set(event.trackId, event.version);
      serverNotesRef.current = {
        ...serverNotesRef.current,
        [event.trackId]: applyNoteEvent(serverNotesRef.current[event.trackId] ?? [], event),
      };

      if (event.actorId === userId) return; // our own echo: version only

      setNotes((prev) => ({
        ...prev,
        [event.trackId]: applyNoteEvent(prev[event.trackId] ?? [], event),
      }));

      // Flash the note somebody else just placed. Without it, notes silently
      // materialise and you cannot tell what changed — the whole value of
      // watching a collaborator work is seeing WHERE they are working.
      if (event.type === "ADD") {
        const key = `${event.trackId}:${event.step}:${event.pitch}`;
        setFlashing((prev) => new Set(prev).add(key));
        window.setTimeout(
          () =>
            setFlashing((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            }),
          700, // must outlast the CSS animation, or it restarts mid-flash
        );
      }
    },
    [userId, setNotes, serverNotesRef, trackVersionsRef],
  );

  /**
   * Somebody told us where they are.
   *
   * HELLO gets answered with our own position, so a newcomer sees the room the
   * instant they arrive instead of waiting up to a heartbeat for everyone to
   * speak. We answer with a CURSOR, never a HELLO — replying to a HELLO with a
   * HELLO is an infinite greeting loop, and with three people in a song it
   * would be a broadcast storm.
   */
  const onPresence = useCallback(
    (event: PresenceEvent) => {
      if (event.userId === userId) return; // our own echo

      if (event.kind === "BYE") {
        setPeers((prev) => {
          const next = { ...prev };
          delete next[event.userId];
          return next;
        });
        return;
      }

      setPeers((prev) => ({ ...prev, [event.userId]: { ...event, lastSeen: Date.now() } }));

      if (event.kind === "HELLO") {
        socketRef.current?.sendPresence({ ...cursorRef.current, kind: "CURSOR" });
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!songId || !loadedSongId) return; // wait for the load, so the baseline exists
    const socket = connectToSong(songId, {
      onNote,
      onPresence,
      onError,
      onStatus: (connected) => {
        setLive(connected);
        if (connected) socket.sendPresence({ ...cursorRef.current, kind: "HELLO" });
        else setPeers({}); // socket died: we know nothing about anyone
      },
    });
    socketRef.current = socket;

    // The heartbeat. Presence is the ONE thing here that must keep speaking
    // while nothing happens — a peer who has stopped moving their mouse is
    // still in the room, and silence is how we decide someone left.
    const heartbeat = setInterval(
      () => socket.sendPresence({ ...cursorRef.current, kind: "CURSOR" }),
      HEARTBEAT_MS,
    );

    // ...and the other half of that deal: expire anyone who has gone quiet. A
    // crashed tab, a closed laptop and a dead network never send BYE, so a list
    // that only removed people on BYE would fill up with ghosts.
    const reaper = setInterval(() => {
      const cutoff = Date.now() - PEER_TIMEOUT_MS;
      setPeers((prev) => {
        const alive = Object.fromEntries(
          Object.entries(prev).filter(([, peer]) => peer.lastSeen > cutoff),
        );
        // Same object when nothing expired — a fresh one every second would
        // re-render the whole grid twice a second for no reason.
        return Object.keys(alive).length === Object.keys(prev).length ? prev : alive;
      });
    }, 2000);

    return () => {
      clearInterval(heartbeat);
      clearInterval(reaper);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current); // a pending cursor frame on a dead socket
        timerRef.current = null;
      }
      socket.sendPresence({ ...cursorRef.current, kind: "BYE" }); // a courtesy, not a guarantee
      socket.close();
      socketRef.current = null;
      setLive(false);
      setPeers({});
    };
    // loadedSongId, not the song object: its identity changes on every reload (a
    // rename, a new lane), and reconnecting the socket each time would drop and
    // re-establish the subscription for no reason.
  }, [songId, loadedSongId, onNote, onPresence, onError]);

  /**
   * Broadcast our cursor as it moves.
   *
   * Throttled, not debounced, and the difference matters: a debounce would send
   * nothing at all until you STOPPED moving, so your cursor would teleport
   * between rests instead of gliding. A throttle sends a steady ~20/sec while
   * you move, which is what makes the remote dot look alive. The frames are
   * tiny and nothing persists them, so the only real cost is bandwidth.
   */
  const reportCursor = useCallback((at: CursorPosition) => {
    cursorRef.current = {
      ...cursorRef.current,
      kind: "CURSOR",
      beatId: at.beatId,
      trackId: at.trackId,
      step: at.step,
      // Left alone when the caller has no pitch axis to report (the channel
      // rack). The rack marker doesn't read row, and the roll cursor keeps
      // pointing at the last pitch you actually touched.
      ...(at.row === undefined ? {} : { row: at.row }),
    };

    const now = Date.now();
    const since = now - lastSentRef.current;
    if (since >= CURSOR_THROTTLE_MS) {
      lastSentRef.current = now;
      socketRef.current?.sendPresence(cursorRef.current);
      return;
    }

    // THE TRAILING EDGE, and it is not an optimisation — without it the throttle
    // silently drops your FINAL position. Flick the mouse to a new cell and stop
    // inside the throttle window and that last move is discarded; no further
    // mousemove ever fires, because the mouse is now still. Your cursor then
    // sits frozen at a stale cell on your collaborator's screen until the next
    // heartbeat drags it over, three seconds later. The bug looks like lag and
    // is actually a lost event.
    if (timerRef.current === null) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        lastSentRef.current = Date.now();
        socketRef.current?.sendPresence(cursorRef.current);
      }, CURSOR_THROTTLE_MS - since);
    }
  }, []);

  return {
    live,
    peers,
    flashing,
    reportCursor,
    connected: () => socketRef.current?.connected() ?? false,
    sendOps: (ops) => ops.forEach((op) => socketRef.current?.send(op)),
  };
}
