import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import { ApiError, gql, rest } from "../api/client";
import type { AudioFile, Beat, Clip, Song, SongEvent, Step } from "../types";
import {
  ADD_BEAT,
  ADD_TRACK,
  DELETE_BEAT,
  DELETE_TRACK,
  GENERATE_PATTERN,
  SAVE_PATTERN,
  SONG_HISTORY,
  SONG_QUERY,
  TRACK_PATTERN_AT,
} from "./queries";

export interface SongData {
  song: Song | null;
  clips: Clip[];
  audioFiles: AudioFile[];
  notes: Record<string, Step[]>;
  dirty: Set<string>;
  saving: boolean;

  setClips: React.Dispatch<React.SetStateAction<Clip[]>>;
  /** The arrangement panel uploads audio and hands the new list back. */
  setAudioFiles: React.Dispatch<React.SetStateAction<AudioFile[]>>;
  setNotes: React.Dispatch<React.SetStateAction<Record<string, Step[]>>>;
  setDirty: React.Dispatch<React.SetStateAction<Set<string>>>;

  /** Live mirrors of the above, for handlers attached once that must not close
   *  over a stale render. See the note in usePlayback. */
  notesRef: React.MutableRefObject<Record<string, Step[]>>;
  dirtyRef: React.MutableRefObject<Set<string>>;
  clipsRef: React.MutableRefObject<Clip[]>;
  beatsRef: React.MutableRefObject<Beat[]>;
  /** Last-known @Version per lane, sent back as expectedVersion on save. */
  trackVersionsRef: React.MutableRefObject<Map<string, number>>;
  /** The server's confirmed picture of every lane — the baseline every outgoing
   *  delta is diffed against. See useAutoSave. */
  serverNotesRef: React.MutableRefObject<Record<string, Step[]>>;

  load: () => Promise<void>;
  /** The whole-pattern HTTP save. The fallback path — see useAutoSave. */
  saveViaHttp: (laneIds: Set<string>) => Promise<void>;

  /** Ask the AI for notes for one lane. Returns server-VALIDATED notes and
   *  saves NOTHING — the caller lands them as ordinary local edits, so
   *  they're auditionable and undoable before they ever persist. THROWS on
   *  failure (unlike the mutate() family): the generate dialog needs the
   *  error to stay open and show it. */
  generatePattern: (trackId: string, prompt: string) => Promise<Step[]>;

  /** The song's edit log, newest first. THROWS — the history panel shows
   *  its own loading/error states. */
  fetchHistory: () => Promise<SongEvent[]>;
  /** One lane's grid as of an event — replayed server-side, saved nowhere.
   *  The caller lands it exactly like a generated pattern. */
  patternAt: (trackId: string, eventId: string) => Promise<Step[]>;

  /** Resolves to the new beat's id, so the caller can select it. */
  addBeat: () => Promise<string | null>;
  removeBeat: (beatId: string) => Promise<void>;
  patchBeat: (beatId: string, body: { name?: string; bars?: number }) => Promise<void>;
  addTrack: (beatId: string, name: string, instrument: string) => Promise<void>;
  removeTrack: (trackId: string) => Promise<void>;
  renameTrack: (trackId: string, name: string) => Promise<void>;
  /** Local-only mix update — what a slider calls MID-DRAG, possibly dozens
   *  of times a second. State only; the caller pushes the same values into
   *  the audio graph, and nothing touches the server. */
  setTrackMixLocal: (trackId: string, mix: { volume?: number; pan?: number }) => void;
  /** Persist the mix at gesture end (pointer-up): ONE PATCH per drag, the
   *  same REST pattern as renames. */
  saveTrackMix: (trackId: string, mix: { volume?: number; pan?: number }) => Promise<void>;
  patchSong: (patch: { title?: string; bpm?: number; timeSignature?: string }) => Promise<void>;
}

/**
 * The song: loading it, mutating its structure, and writing patterns back.
 *
 * Everything here talks to the server. What it deliberately does NOT know about
 * is the socket — a delta save needs a live channel, and wiring that in here
 * would make this hook and useRealtime mutually dependent (the socket's note
 * handler writes the state this hook owns). useAutoSave composes the two
 * instead, which keeps the dependency acyclic and puts the "which path does this
 * edit take?" decision in exactly one place.
 */
export function useSongData(params: {
  songId: string | undefined;
  onError: (message: string) => void;
  /** The audio engine owns instrument lifecycles, but lanes appear and vanish
   *  HERE, so this hook is what tells it (mix included — server truth). */
  ensureInstrument: (laneId: string, instrument: string, mix?: { volume?: number; pan?: number }) => void;
  disposeInstrument: (laneId: string) => void;
  /** Server truth replaces local state, so stale undo targets go with it. */
  resetHistory: () => void;
  /** Selection and per-lane octaves have to be re-pointed at whatever survived
   *  the reload. The page owns that state; this hook hands it the new beats. */
  reconcile: (beats: Beat[]) => void;
}): SongData {
  const { songId, onError, ensureInstrument, disposeInstrument, resetHistory, reconcile } = params;

  const [song, setSong] = useState<Song | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [notes, setNotes] = useState<Record<string, Step[]>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const beatsRef = useRef<Beat[]>([]);
  const trackVersionsRef = useRef<Map<string, number>>(new Map());
  const serverNotesRef = useRef<Record<string, Step[]>>({});

  const load = useCallback(async () => {
    try {
      const data = await gql<{ song: Song }>(SONG_QUERY, { id: songId });
      setSong(data.song);
      const beats = [...data.song.beats].sort((a, b) => a.position - b.position);
      beatsRef.current = beats;
      setClips(data.song.clips);
      setAudioFiles(data.song.audioFiles);

      // Patterns and instruments are keyed by LANE id, flattened across
      // all beats — the engine and the roll don't care which beat owns a
      // lane, only the selectors do.
      const next: Record<string, Step[]> = {};
      for (const beat of beats) {
        for (const lane of beat.tracks) {
          next[lane.id] = lane.pattern;
          trackVersionsRef.current.set(lane.id, lane.version);
          ensureInstrument(lane.id, lane.instrument, { volume: lane.volume, pan: lane.pan });
        }
      }
      setNotes(next);
      // The baseline every outgoing delta is computed against: what the SERVER
      // last confirmed each lane holds. Kept up to date by the broadcast
      // handler, so it tracks other people's edits too — which is what makes
      // our diff produce only OUR changes and not a re-send of theirs.
      serverNotesRef.current = { ...next };
      resetHistory();
      reconcile(beats);
      // Dirty lanes that no longer exist would make save() fail forever.
      setDirty((prev) => {
        const laneIds = new Set(beats.flatMap((b) => b.tracks.map((t) => t.id)));
        return new Set([...prev].filter((id) => laneIds.has(id)));
      });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Failed to load song");
    }
  }, [songId, onError, ensureInstrument, resetHistory, reconcile]);

  /**
   * FALLBACK: socket down (backend restart, flaky wifi, a tab left open
   * overnight). The whole-pattern save, which still sends expectedVersion to
   * stop us silently overwriting somebody. Degraded, but honest: it refuses
   * rather than clobbers.
   */
  async function saveViaHttp(laneIds: Set<string>) {
    setSaving(true);
    try {
      for (const trackId of laneIds) {
        const pattern = (notesRef.current[trackId] ?? []).map(
          ({ step, pitch, velocity, length }) => ({ step, pitch, velocity, length }),
        );
        // expectedVersion = the version we loaded (or last saved): if the
        // row moved on under us the server answers CONFLICT instead of
        // silently overwriting the other editor's grid.
        const data = await gql<{ updateTrackPattern: { id: string; version: number } }>(
          SAVE_PATTERN,
          { id: trackId, pattern, expectedVersion: trackVersionsRef.current.get(trackId) ?? null },
        );
        trackVersionsRef.current.set(trackId, data.updateTrackPattern.version);
        // The server now holds exactly what we sent, so the delta baseline must
        // say so too — otherwise, when the socket comes back, the next diff
        // would re-emit every note in this lane as a fresh ADD.
        serverNotesRef.current = {
          ...serverNotesRef.current,
          [trackId]: notesRef.current[trackId] ?? [],
        };
      }
      setDirty(new Set());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone edited this lane while our socket was down. Reload rather
        // than overwrite — the delta path merges, but this fallback cannot.
        onError(`${e.message} — reloaded the latest version`);
        await load();
        setDirty(new Set());
      } else {
        onError(e instanceof ApiError ? e.message : "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  /** Every structural mutation follows the same shape: call the server, then
   *  reload. Wrapping it kills seven identical try/catch blocks. */
  async function mutate(what: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : what);
    }
  }

  return {
    song,
    clips,
    audioFiles,
    notes,
    dirty,
    saving,
    setClips,
    setAudioFiles,
    setNotes,
    setDirty,
    notesRef,
    dirtyRef,
    clipsRef,
    beatsRef,
    trackVersionsRef,
    serverNotesRef,
    load,
    saveViaHttp,

    generatePattern: async (trackId, prompt) => {
      const data = await gql<{ generateTrackPattern: Step[] }>(GENERATE_PATTERN, {
        trackId,
        prompt,
      });
      return data.generateTrackPattern;
    },

    fetchHistory: async () => {
      const data = await gql<{ songHistory: SongEvent[] }>(SONG_HISTORY, { songId });
      return data.songHistory;
    },

    patternAt: async (trackId, eventId) => {
      const data = await gql<{ trackPatternAt: Step[] }>(TRACK_PATTERN_AT, { trackId, eventId });
      return data.trackPatternAt;
    },

    // No name field: "+" in the beat browser creates "Beat N" immediately, and
    // the name is editable in place (double-click) like every other name in the
    // app. A form standing between you and the work is exactly the MVP smell.
    //
    // Returns the new beat's id so the caller can SELECT it: reconcile() keeps
    // whatever was selected before, which after "+" is the wrong beat.
    addBeat: async () => {
      try {
        const name = `Beat ${beatsRef.current.length + 1}`;
        const data = await gql<{ addBeat: { id: string } }>(ADD_BEAT, { input: { songId, name } });
        await load();
        return data.addBeat.id;
      } catch (e) {
        onError(e instanceof ApiError ? e.message : "Failed to add beat");
        return null;
      }
    },

    removeBeat: (beatId) =>
      mutate("Failed to delete beat", async () => {
        const laneIds = beatsRef.current.find((b) => b.id === beatId)?.tracks.map((t) => t.id) ?? [];
        await gql(DELETE_BEAT, { id: beatId });
        for (const laneId of laneIds) disposeInstrument(laneId);
        await load(); // also refreshes clips — the server cascaded them
      }),

    patchBeat: (beatId, body) =>
      mutate("Failed to update beat", async () => {
        // The shrink guard's message ("delete them first") surfaces here.
        await rest(`/api/beats/${beatId}`, { method: "PATCH", body });
        const patch = (beats: Beat[]) => beats.map((b) => (b.id === beatId ? { ...b, ...body } : b));
        beatsRef.current = patch(beatsRef.current);
        setSong((prev) => (prev ? { ...prev, beats: patch(prev.beats) } : prev));
      }),

    addTrack: (beatId, name, instrument) =>
      mutate("Failed to add lane", async () => {
        await gql(ADD_TRACK, { input: { beatId, name, instrument } });
        await load();
      }),

    removeTrack: (trackId) =>
      mutate("Failed to delete lane", async () => {
        await gql(DELETE_TRACK, { id: trackId });
        disposeInstrument(trackId);
        await load();
      }),

    // Renames ride on REST (PATCH), not GraphQL — single-field updates have no
    // field-selection story, so the graph buys nothing (mirrors the server-side
    // note on SongRestController). On success we patch local state instead of
    // re-running load(): the server confirmed exactly this change, and a full
    // reload would drop unsaved pattern edits.
    renameTrack: (trackId, name) =>
      mutate("Failed to rename lane", async () => {
        await rest(`/api/tracks/${trackId}`, { method: "PATCH", body: { name } });
        const patch = (beats: Beat[]) =>
          beats.map((b) => ({
            ...b,
            tracks: b.tracks.map((t) => (t.id === trackId ? { ...t, name } : t)),
          }));
        beatsRef.current = patch(beatsRef.current);
        setSong((prev) => (prev ? { ...prev, beats: patch(prev.beats) } : prev));
      }),

    setTrackMixLocal: (trackId, mix) => {
      const patch = (beats: Beat[]) =>
        beats.map((b) => ({
          ...b,
          tracks: b.tracks.map((t) => (t.id === trackId ? { ...t, ...mix } : t)),
        }));
      beatsRef.current = patch(beatsRef.current);
      setSong((prev) => (prev ? { ...prev, beats: patch(prev.beats) } : prev));
    },

    saveTrackMix: (trackId, mix) =>
      mutate("Failed to save the mix", async () => {
        // Local state was already updated live during the drag — the
        // server just needs the final values. Reload is the recovery if
        // this fails (the error banner says so via mutate).
        await rest(`/api/tracks/${trackId}`, { method: "PATCH", body: mix });
      }),

    patchSong: (patch) =>
      mutate("Failed to update song", async () => {
        await rest(`/api/songs/${songId}`, { method: "PATCH", body: patch });
        setSong((prev) => (prev ? { ...prev, ...patch } : prev));
        // A live loop keeps its scheduled step times, but the transport tempo
        // can follow immediately — the next play is fully correct.
        if (patch.bpm) Tone.getTransport().bpm.value = patch.bpm;
      }),
  };
}
