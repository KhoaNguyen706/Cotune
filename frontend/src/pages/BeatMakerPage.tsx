import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Tone from "tone";
import { useAuth } from "../auth/AuthContext";
import { useSettings } from "../ui/settings";
import {
  applyNoteEvent,
  connectToSong,
  diffNotes,
  type NoteEvent,
  type SongSocket,
} from "../realtime/socket";
import { ApiError, gql, rest } from "../api/client";
import {
  arrangementEndSeconds,
  downloadBlob,
  encodeWav,
  prefetchBuffers,
  renderArrangement,
  scheduleArrangement,
  secondsPerStep,
  type ArrangementSources,
} from "../audio/engine";
import { encodeMp3 } from "../audio/mp3";
import { createInstrument, type TrackInstrument } from "../audio/instruments";
import { ArrangementPalette, ArrangementTimeline, type Armed } from "../components/ArrangementPanel";
import { SettingsModal } from "../ui/SettingsModal";
import { beatColor, colorFor } from "../ui/trackColors";
import { Button, EditableName, EmptyState, ErrorBanner, Select, Skeleton, TextInput } from "../ui/kit";
import {
  AppShell,
  Canvas,
  CanvasBar,
  IconButton,
  Readout,
  Sidebar,
  SidebarSection,
  ToolGroup,
  TopBar,
  Workspace,
} from "../ui/shell";
import { canEditSong } from "../types";
import type { AudioFile, Beat, Clip, Song, Step } from "../types";

const STEPS = 16;
// One octave, top-to-bottom like every DAW: high notes up. Sharps get the
// dark "black key" row shading.
const PITCH_ROWS = ["B", "A#", "A", "G#", "G", "F#", "F", "E", "D#", "D", "C#", "C"];
// Cell geometry lives in ONE place (inline styles derive from these) —
// drag math and rendering must agree to the pixel, so they share constants
// instead of duplicating numbers in CSS.
const CELL_W = 34;
const CELL_H = 26;

const SONG_QUERY = `
  query Song($id: ID!) {
    song(id: $id) {
      id title bpm timeSignature ownerId myRole
      collaborators { userId email displayName role }
      beats {
        id name position bars
        tracks { id name instrument position version pattern { step pitch velocity length } }
      }
      clips { id lane startStep lengthSteps type beatId audioId }
      audioFiles { id filename contentType sizeBytes durationSeconds }
    }
  }
`;

const ADD_BEAT = `
  mutation AddBeat($input: AddBeatInput!) {
    addBeat(input: $input) { id }
  }
`;

const DELETE_BEAT = `
  mutation DeleteBeat($id: ID!) { deleteBeat(id: $id) }
`;

const ADD_TRACK = `
  mutation AddTrack($input: AddTrackInput!) {
    addTrack(input: $input) { id }
  }
`;

const DELETE_TRACK = `
  mutation DeleteTrack($id: ID!) { deleteTrack(id: $id) }
`;

const SAVE_PATTERN = `
  mutation SavePattern($id: ID!, $pattern: [StepInput!]!, $expectedVersion: Int) {
    updateTrackPattern(id: $id, pattern: $pattern, expectedVersion: $expectedVersion) { id version }
  }
`;

interface DragState {
  trackId: string;
  index: number;
  mode: "move" | "resize";
  grabOffset: number; // move only: steps between note.step and the grabbed cell
  rect: DOMRect; // roll geometry captured at drag start
  moved: boolean; // false until the mouse leaves the starting cell — a
  // "click" is a drag that never moved; we use it for note selection
  recorded: boolean; // history snapshot taken for this gesture? One drag =
  // one undo entry, captured lazily on the FIRST actual change so plain
  // clicks (note selection) never pollute the history
}

/** One undoable editor state: the whole grid + which lanes were unsaved.
 *  Snapshots are shallow — pattern arrays are replaced, never mutated
 *  (see updateNote), so sharing them across entries is safe. */
interface HistoryEntry {
  notes: Record<string, Step[]>;
  dirty: Set<string>;
}

function pitchOf(row: number, octave: number): string {
  return PITCH_ROWS[row] + octave;
}

function rowOf(pitch: string, octave: number): number | null {
  const match = /^([A-G]#?)([0-8])$/.exec(pitch);
  if (!match || Number(match[2]) !== octave) return null;
  const row = PITCH_ROWS.indexOf(match[1]);
  return row >= 0 ? row : null;
}

export function BeatMakerPage() {
  const { songId } = useParams<{ songId: string }>();
  // We need our own id again — NOT to decide what we may do (the server sends
  // myRole for that), but to recognise our own edits coming back on the
  // broadcast. Different question, different answer.
  const { user } = useAuth();
  const { autoSave } = useSettings();
  /** Is the real-time channel actually up? Drives the badge, and decides
   *  whether edits leave as deltas or as a whole-pattern HTTP save. */
  const [live, setLive] = useState(false);
  const [song, setSong] = useState<Song | null>(null);
  // Two editors, one page: "arrange" is the song timeline (clips place
  // whole beats), "beats" is where you build each beat — pick Beat 1/2/3,
  // edit its instrument lanes. One transport serves both.
  const [mode, setMode] = useState<"arrange" | "beats">("arrange");
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [notesByTrack, setNotesByTrack] = useState<Record<string, Step[]>>({});
  const [clips, setClips] = useState<Clip[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  // The armed material ("what am I about to place?") is shared by the
  // palette (sidebar) and the timeline (canvas) — two siblings, so the
  // state lives in their closest common ancestor: here.
  const [armed, setArmed] = useState<Armed>(null);
  // Folded while you drag a clip (the timeline asks for the width), and
  // togglable by hand.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null); // lane id
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [octaves, setOctaves] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [soloed, setSoloed] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1); // beat-loop playhead (0..15)
  const [arrangeStep, setArrangeStep] = useState(-1); // arrangement playhead (absolute)
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newTrackName, setNewTrackName] = useState("");
  const [newInstrument, setNewInstrument] = useState("DRUMS");

  // Mutable, non-rendering machinery lives in refs (see Session 5 notes on
  // stale closures): the transport callback and drag handlers are created
  // once but must always see current data.
  const instrumentsRef = useRef<Map<string, TrackInstrument>>(new Map());
  const notesRef = useRef(notesByTrack);
  notesRef.current = notesByTrack;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Undo/redo over PATTERN edits only (local, pre-save). Server-synced
  // structure (beats, lanes, clips) is out of scope until inverse server
  // ops exist — that's collaboration-phase machinery.
  const historyRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const [historySizes, setHistorySizes] = useState({ past: 0, future: 0 });
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const beatsRef = useRef<Beat[]>([]);
  // Last-known @Version per lane, sent back as expectedVersion on save.
  const trackVersionsRef = useRef<Map<string, number>>(new Map());
  // The server's confirmed picture of every lane. Diffing local state against
  // THIS (rather than against the last thing we sent) is what lets a remote
  // edit and a local edit coexist: their note is already in the baseline, so we
  // never emit an op that would undo it.
  const serverNotesRef = useRef<Record<string, Step[]>>({});
  const socketRef = useRef<SongSocket | null>(null);
  // Steps in the SELECTED beat's grid (bars × 16). A ref because the
  // once-attached drag handlers must clamp against the current value.
  const beatStepsRef = useRef(STEPS);
  const selectedBeatIdRef = useRef(selectedBeatId);
  selectedBeatIdRef.current = selectedBeatId;
  const playersRef = useRef<Tone.Player[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const rollRef = useRef<HTMLDivElement | null>(null);
  const octavesRef = useRef(octaves);
  octavesRef.current = octaves;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const soloedRef = useRef(soloed);
  soloedRef.current = soloed;

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
          if (!instrumentsRef.current.has(lane.id)) {
            instrumentsRef.current.set(lane.id, createInstrument(lane.instrument));
          }
        }
      }
      setNotesByTrack(next);
      // The baseline every outgoing delta is computed against: what the SERVER
      // last confirmed each lane holds. Kept up to date by the broadcast
      // handler, so it tracks other people's edits too — which is what makes
      // our diff produce only OUR changes and not a re-send of theirs.
      serverNotesRef.current = { ...next };
      // Server truth replaces local state — stale undo targets with it.
      historyRef.current = { past: [], future: [] };
      setHistorySizes({ past: 0, future: 0 });
      setOctaves((prev) => {
        const merged = { ...prev };
        for (const beat of beats) {
          for (const lane of beat.tracks) {
            merged[lane.id] ??= instrumentsRef.current.get(lane.id)!.defaultOctave;
          }
        }
        return merged;
      });
      setSelectedBeatId((prev) =>
        prev && beats.some((b) => b.id === prev) ? prev : beats[0]?.id ?? null,
      );
      setSelectedId((prev) => {
        const laneIds = new Set(beats.flatMap((b) => b.tracks.map((t) => t.id)));
        if (prev && laneIds.has(prev)) return prev;
        return beats[0]?.tracks[0]?.id ?? null;
      });
      // Dirty lanes that no longer exist would make save() fail forever.
      setDirty((prev) => {
        const laneIds = new Set(beats.flatMap((b) => b.tracks.map((t) => t.id)));
        return new Set([...prev].filter((id) => laneIds.has(id)));
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load song");
    }
  }, [songId]);

  useEffect(() => {
    void load();
    const instruments = instrumentsRef.current;
    const players = playersRef;
    return () => {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      for (const player of players.current) {
        player.unsync();
        player.dispose();
      }
      players.current = [];
      instruments.forEach((i) => i.dispose());
      instruments.clear();
    };
  }, [load]);

  // Unsaved work guard: the browser shows a "leave site?" prompt while any
  // lane is dirty. Cheap insurance against losing a beat to a reflexive
  // tab-close — and it disappears the moment you save.
  useEffect(() => {
    if (dirty.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- undo/redo ---------------------------------------------------------
  // These read ONLY refs and stable setters, so the once-attached keyboard
  // handler can safely close over the first render's instances.

  /** Call BEFORE a mutation: pushes the current state as an undo point. */
  function recordHistory() {
    const h = historyRef.current;
    h.past.push({ notes: notesRef.current, dirty: dirtyRef.current });
    if (h.past.length > 100) h.past.shift(); // bounded — old history is noise
    h.future = []; // a new edit forks the timeline; redo targets are gone
    setHistorySizes({ past: h.past.length, future: 0 });
  }

  function undo() {
    const h = historyRef.current;
    const entry = h.past.pop();
    if (!entry) return;
    h.future.push({ notes: notesRef.current, dirty: dirtyRef.current });
    setNotesByTrack(entry.notes);
    setDirty(entry.dirty);
    setSelectedNote(null); // indices may no longer exist in the restored grid
    setHistorySizes({ past: h.past.length, future: h.future.length });
  }

  function redo() {
    const h = historyRef.current;
    const entry = h.future.pop();
    if (!entry) return;
    h.past.push({ notes: notesRef.current, dirty: dirtyRef.current });
    setNotesByTrack(entry.notes);
    setDirty(entry.dirty);
    setSelectedNote(null);
    setHistorySizes({ past: h.past.length, future: h.future.length });
  }

  function updateNote(trackId: string, index: number, changes: Partial<Step>) {
    setNotesByTrack((prev) => {
      const notes = [...(prev[trackId] ?? [])];
      const updated = { ...notes[index], ...changes };
      // The backend rejects two events at the same step+pitch; blocking the
      // collision in the editor beats a save-time error message.
      const collides = notes.some(
        (n, i) => i !== index && n.step === updated.step && n.pitch === updated.pitch,
      );
      if (collides) return prev;
      notes[index] = updated;
      return { ...prev, [trackId]: notes };
    });
    setDirty((prev) => new Set(prev).add(trackId));
  }

  function preview(trackId: string, pitch: string, velocity = 0.9) {
    instrumentsRef.current.get(trackId)?.trigger(undefined, pitch, velocity);
  }

  // ---- piano roll mouse interactions -----------------------------------

  function cellFromEvent(e: MouseEvent | React.MouseEvent, rect: DOMRect) {
    const col = Math.max(0, Math.min(beatStepsRef.current - 1, Math.floor((e.clientX - rect.left) / CELL_W)));
    const row = Math.max(0, Math.min(PITCH_ROWS.length - 1, Math.floor((e.clientY - rect.top) / CELL_H)));
    return { col, row };
  }

  function onRollMouseDown(e: React.MouseEvent) {
    // Only empty-cell presses land here — notes stop propagation.
    if (!selectedId || e.button !== 0 || !rollRef.current) return;
    e.preventDefault();
    setSelectedNote(null);
    const rect = rollRef.current.getBoundingClientRect();
    const { col, row } = cellFromEvent(e, rect);
    const pitch = pitchOf(row, octaves[selectedId] ?? 4);
    const notes = notesRef.current[selectedId] ?? [];
    if (notes.some((n) => n.step === col && n.pitch === pitch)) return;

    recordHistory(); // undo removes the note (and any stretch that follows)
    setNotesByTrack((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), { step: col, pitch, velocity: 0.9, length: 1 }],
    }));
    setDirty((prev) => new Set(prev).add(selectedId));
    preview(selectedId, pitch);
    // FL-style: the fresh note is immediately in resize mode — press,
    // drag right, release = a note exactly as long as you dragged.
    // recorded: true — add + stretch is ONE gesture, one undo entry.
    dragRef.current = { trackId: selectedId, index: notes.length, mode: "resize", grabOffset: 0, rect, moved: false, recorded: true };
  }

  function onNoteMouseDown(e: React.MouseEvent, index: number, note: Step, resize: boolean) {
    if (!selectedId || e.button !== 0 || !rollRef.current) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the roll create a note underneath
    const rect = rollRef.current.getBoundingClientRect();
    const { col } = cellFromEvent(e, rect);
    dragRef.current = {
      trackId: selectedId,
      index,
      mode: resize ? "resize" : "move",
      grabOffset: col - note.step,
      rect,
      moved: false,
      recorded: false, // snapshot lazily on first change — clicks stay free
    };
  }

  function onNoteContextMenu(e: React.MouseEvent, index: number) {
    // Right-click deletes — the DAW convention.
    e.preventDefault();
    if (!selectedId) return;
    recordHistory();
    setSelectedNote(null);
    setNotesByTrack((prev) => ({
      ...prev,
      [selectedId]: (prev[selectedId] ?? []).filter((_, i) => i !== index),
    }));
    setDirty((prev) => new Set(prev).add(selectedId));
  }

  // Document-level listeners so a drag survives leaving the grid; attached
  // once, reading current drag state through the ref.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const note = notesRef.current[drag.trackId]?.[drag.index];
      if (!note) return;
      const { col, row } = cellFromEvent(e, drag.rect);
      if (drag.mode === "resize") {
        const length = Math.max(1, Math.min(beatStepsRef.current - note.step, col - note.step + 1));
        if (length !== note.length) {
          if (!drag.recorded) {
            recordHistory(); // one entry per gesture, taken pre-change
            drag.recorded = true;
          }
          drag.moved = true;
          updateNote(drag.trackId, drag.index, { length });
        }
      } else {
        const octave = octavesRef.current[drag.trackId] ?? 4;
        const step = Math.max(0, Math.min(beatStepsRef.current - note.length, col - drag.grabOffset));
        const pitch = pitchOf(row, octave);
        if (step !== note.step || pitch !== note.pitch) {
          if (!drag.recorded) {
            recordHistory();
            drag.recorded = true;
          }
          drag.moved = true;
          updateNote(drag.trackId, drag.index, { step, pitch });
          if (pitch !== note.pitch) preview(drag.trackId, pitch, note.velocity);
        }
      }
    }
    function onUp() {
      const drag = dragRef.current;
      // A press-and-release that never moved is a CLICK — select the note
      // so the velocity slider (and Delete key) target it.
      if (drag && !drag.moved && drag.mode === "move") {
        setSelectedNote(drag.index);
      }
      dragRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- transport ---------------------------------------------------------

  // Master volume, 0-100 mapped to decibels on Tone's destination node.
  // gainToDb is logarithmic — perceived loudness, not linear amplitude
  // (a linear volume slider feels "all in the last 10%").
  const [volume, setVolume] = useState(80);
  function applyVolume(v: number) {
    setVolume(v);
    Tone.getDestination().volume.value = v === 0 ? -Infinity : Tone.gainToDb(v / 100);
  }

  // One-click "is my audio path alive?" — a mid-range blip no speaker can
  // miss. Debugging affordance for the user, not a musical feature: it
  // separates "app is broken" from "tab/OS is muted" instantly.
  async function testSound() {
    await Tone.start();
    const synth = new Tone.Synth().toDestination();
    synth.triggerAttackRelease("C5", "8n");
    setTimeout(() => synth.dispose(), 1000);
  }

  /** Solo wins over mute, DAW-standard: if ANY lane is soloed, only
   *  soloed lanes sound; otherwise everything not muted sounds. */
  function isAudible(trackId: string): boolean {
    return soloedRef.current.size > 0
      ? soloedRef.current.has(trackId)
      : !mutedRef.current.has(trackId);
  }

  function stopPlayback() {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    // Synced players outlive transport.cancel(); without disposal each
    // play would stack another copy of every audio clip.
    for (const player of playersRef.current) {
      player.unsync();
      player.dispose();
    }
    playersRef.current = [];
    setPlaying(false);
    setCurrentStep(-1);
    setArrangeStep(-1);
  }

  function currentSources(): ArrangementSources | null {
    if (!song) return null;
    return {
      bpm: song.bpm,
      clips: clipsRef.current,
      beats: beatsRef.current,
      // LIVE patterns (possibly unsaved) — what you hear matches the grid.
      patterns: notesRef.current,
    };
  }

  async function playArrangement() {
    const sources = currentSources();
    if (!sources) return;
    const end = arrangementEndSeconds(sources);
    if (end === 0) {
      setError("The timeline is empty — arm a beat in the left palette and click a lane to place it.");
      return;
    }
    await Tone.start();
    const transport = Tone.getTransport();
    transport.bpm.value = sources.bpm;
    const buffers = await prefetchBuffers(sources.clips);
    playersRef.current = scheduleArrangement({
      sources,
      instruments: instrumentsRef.current,
      buffers,
      audible: isAudible,
    });
    // Playhead sweep + auto-stop at the arrangement's right edge.
    let step = 0;
    transport.scheduleRepeat((time) => {
      const current = step++;
      Tone.getDraw().schedule(() => setArrangeStep(current), time);
    }, secondsPerStep(sources.bpm), 0);
    transport.schedule((time) => {
      Tone.getDraw().schedule(() => stopPlayback(), time);
    }, end + 0.1);
    transport.start();
    setPlaying(true);
  }

  async function playBeatLoop() {
    if (!song) return;
    const beat = beatsRef.current.find((b) => b.id === selectedBeatIdRef.current);
    if (!beat) {
      setError("No beat selected — create one first.");
      return;
    }
    // Pressing play on a silent beat is the #1 "sound is broken" report —
    // say why instead of sweeping an empty playhead in silence.
    const totalNotes = beat.tracks.reduce(
      (n, lane) => n + (notesRef.current[lane.id]?.length ?? 0), 0);
    if (totalNotes === 0) {
      setError(`"${beat.name}" has no notes yet — click cells in the piano roll below, then press play.`);
      return;
    }
    await Tone.start();
    Tone.getTransport().bpm.value = song.bpm;
    let step = 0;
    Tone.getTransport().scheduleRepeat((time) => {
      // Loop the SELECTED beat only — this view is the beat workbench;
      // hearing the whole song is what the Arrange tab is for.
      const looping = beatsRef.current.find((b) => b.id === selectedBeatIdRef.current);
      const current = step % ((looping?.bars ?? 1) * STEPS);
      const sixteenth = Tone.Time("16n").toSeconds();
      for (const lane of looping?.tracks ?? []) {
        if (!isAudible(lane.id)) continue;
        for (const note of notesRef.current[lane.id] ?? []) {
          if (note.step === current) {
            // try/catch PER NOTE: monophonic synths (drums, bass) throw on
            // two notes at the exact same tick. Without isolation, one bad
            // chord on lane 1 would silence every later lane on that
            // tick, every loop — which users report as "play is broken".
            try {
              instrumentsRef.current
                .get(lane.id)
                ?.trigger(time, note.pitch, note.velocity, note.length * sixteenth);
            } catch {
              // skip the colliding note; the rest of the tick still plays
            }
          }
        }
      }
      Tone.getDraw().schedule(() => setCurrentStep(current), time);
      step++;
    }, "16n");
    Tone.getTransport().start();
    setPlaying(true);
  }

  async function togglePlay() {
    if (!song) return;
    if (playing) {
      stopPlayback();
      return;
    }
    setError(null);
    if (mode === "arrange") await playArrangement();
    else await playBeatLoop();
  }

  function switchMode(next: "arrange" | "beats") {
    // Switching views mid-playback would leave the play button lying about
    // what it plays — stop first.
    if (playing) stopPlayback();
    setMode(next);
  }

  async function exportAs(format: "wav" | "mp3") {
    const sources = currentSources();
    if (!sources || !song) return;
    if (arrangementEndSeconds(sources) === 0) {
      setError("Nothing to export — place beats or audio on the timeline first.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const buffers = await prefetchBuffers(sources.clips);
      // One offline render, then the format is just an encoder choice.
      const rendered = await renderArrangement(sources, buffers);
      const blob = format === "wav" ? encodeWav(rendered) : encodeMp3(rendered);
      const safeTitle = song.title.replace(/[^\w\- ]+/g, "").trim() || "cotune-song";
      downloadBlob(blob, `${safeTitle}.${format}`);
    } catch {
      setError("Export failed — try playing the arrangement once, then export again.");
    } finally {
      setExporting(false);
    }
  }

  // Spacebar = play/stop, Delete/Backspace = remove the selected note.
  // The handler reads through a ref because it's attached once, but
  // togglePlay closes over fresh state on every render.
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  const selectedNoteRef = useRef<{ trackId: string | null; index: number | null }>({ trackId: null, index: null });
  selectedNoteRef.current = { trackId: selectedId, index: selectedNote };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Never hijack keys while the user is typing in a form field.
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault(); // spacebar scrolls the page by default
        void togglePlayRef.current();
      }
      if ((e.code === "Delete" || e.code === "Backspace")) {
        const { trackId, index } = selectedNoteRef.current;
        if (trackId !== null && index !== null) {
          recordHistory();
          setNotesByTrack((prev) => ({
            ...prev,
            [trackId]: (prev[trackId] ?? []).filter((_, i) => i !== index),
          }));
          setDirty((prev) => new Set(prev).add(trackId));
          setSelectedNote(null);
        }
      }
      // Ctrl/Cmd+Z = undo, +Shift = redo; Ctrl+Y = the Windows redo.
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
        e.preventDefault();
        redo();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Can this account edit this song? ASK THE SERVER — don't re-derive it.
   *
   * Session 14 filled the console with 403s because this line was a COPY of
   * the server's rule, and copies drift: the UI offered rename, bar changes
   * and pattern saves on songs the server would always refuse. The fix then
   * was to copy the rule more carefully. That was the wrong fix — V10 proved
   * it, because with sharing the rule stopped being derivable from ownerId at
   * all (an EDITOR doesn't own the song and can still write to it).
   *
   * So the server now sends its verdict as `myRole` and the client reads it.
   * One rule, one implementation, no drift possible.
   */
  const canEdit = song != null && canEditSong(song);
  const readOnly = song != null && !canEdit;

  // ---- real-time channel -------------------------------------------------

  /**
   * Somebody (possibly us) changed a note.
   *
   * The two lines below look almost identical and are doing completely
   * different jobs:
   *
   *   serverNotesRef — ALWAYS updated. It is our picture of the server, and the
   *     server just told us what it holds. Skipping our own echo here would
   *     leave the baseline stale, and the next diff would re-send an op we
   *     already landed.
   *
   *   notesByTrack (the rendered grid) — updated only for OTHER people's ops.
   *     Ours is already on screen; re-applying our own echo would resurrect a
   *     stale note. Concretely: add a note, drag it one step right, and then
   *     your own ADD (for the ORIGINAL position, sent before the drag) arrives
   *     — apply it and you now have two notes, one of which you deliberately
   *     moved away from. Silent, and maddening to debug.
   */
  const onNoteEvent = useCallback(
    (event: NoteEvent) => {
      trackVersionsRef.current.set(event.trackId, event.version);
      serverNotesRef.current = {
        ...serverNotesRef.current,
        [event.trackId]: applyNoteEvent(serverNotesRef.current[event.trackId] ?? [], event),
      };

      if (event.actorId === user?.id) return; // our own echo: version only

      setNotesByTrack((prev) => ({
        ...prev,
        [event.trackId]: applyNoteEvent(prev[event.trackId] ?? [], event),
      }));
    },
    [user?.id],
  );

  useEffect(() => {
    if (!songId || !song) return; // wait for the load, so the baseline exists
    const socket = connectToSong(songId, {
      onNote: onNoteEvent,
      onError: (message) => setError(message),
      onStatus: setLive,
    });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
      setLive(false);
    };
    // song?.id, not `song`: the object identity changes on every reload (a
    // rename, a new lane), and reconnecting the socket each time would drop
    // and re-establish the subscription for no reason.
  }, [songId, song?.id, onNoteEvent]);

  // ---- auto-save ---------------------------------------------------------
  // Debounced: fires a second after you STOP editing, not on every note.
  // The timer is keyed on `dirty` — each new edit replaces the pending
  // save, so a fast run of edits produces exactly one request at the end.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    // `|| live`: while the real-time channel is up we ALWAYS flush on the
    // debounce, even for someone who turned auto-save off. Auto-save is a
    // preference about when your work is written to disk; it is not a
    // preference about whether your collaborators can see what you are doing.
    // Honouring it here would leave the other person staring at a stale grid
    // and calling it a bug.
    if (!(autoSave || live) || readOnly || dirty.size === 0 || saving) return;
    const timer = setTimeout(() => void saveRef.current(), 1000);
    return () => clearTimeout(timer);
  }, [autoSave, live, readOnly, dirty, saving]);

  async function save() {
    // Belt and braces: even with the UI gated, never fire a write the
    // server is guaranteed to reject.
    if (readOnly) return;

    // THE REAL-TIME PATH. Send what CHANGED, not what we hold.
    //
    // The whole-pattern save below is the same operation expressed as "here is
    // my entire lane" — and that phrasing is what makes concurrent editing
    // impossible, because our array cannot describe a note we have never heard
    // of, so writing it deletes theirs. The diff says only "add C3 at 4", which
    // the server merges into whatever the lane holds by now, including edits
    // that landed while we were dragging.
    //
    // Note there is no await and no dirty-lane loop over the network: ops are
    // fire-and-forget. Their acknowledgement is the broadcast coming back,
    // which updates serverNotesRef — and if one never arrives, the next diff
    // simply re-derives it. Re-sending is safe because every op is idempotent.
    const socket = socketRef.current;
    if (socket?.connected()) {
      for (const trackId of dirty) {
        const before = serverNotesRef.current[trackId] ?? [];
        const after = notesRef.current[trackId] ?? [];
        for (const op of diffNotes(trackId, before, after)) {
          socket.send(op);
        }
      }
      setDirty(new Set());
      return;
    }

    // FALLBACK: socket down (backend restart, flaky wifi, a tab left open
    // overnight). Fall back to the HTTP whole-pattern save, which still has
    // expectedVersion to stop us silently overwriting somebody. Degraded, but
    // honest: it refuses rather than clobbers.
    setSaving(true);
    setError(null);
    try {
      for (const trackId of dirty) {
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
        setError(`${e.message} — reloaded the latest version`);
        await load();
        setDirty(new Set());
      } else {
        setError(e instanceof ApiError ? e.message : "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  // The auto-save effect above is attached once, so it must reach the
  // CURRENT save() — which closes over fresh state on every render.
  saveRef.current = save;

  // No name field any more: "+" in the beat browser creates "Beat N"
  // immediately, and the name is editable in place (double-click) like
  // every other name in the app. A form standing between you and the work
  // is exactly the MVP smell we're removing.
  async function addBeat() {
    setError(null);
    try {
      const name = `Beat ${beatsRef.current.length + 1}`;
      const data = await gql<{ addBeat: { id: string } }>(ADD_BEAT, { input: { songId, name } });
      await load();
      setSelectedBeatId(data.addBeat.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add beat");
    }
  }

  async function removeBeat(beatId: string) {
    setError(null);
    try {
      const laneIds = beatsRef.current.find((b) => b.id === beatId)?.tracks.map((t) => t.id) ?? [];
      await gql(DELETE_BEAT, { id: beatId });
      for (const laneId of laneIds) {
        instrumentsRef.current.get(laneId)?.dispose();
        instrumentsRef.current.delete(laneId);
      }
      if (selectedBeatId === beatId) setSelectedBeatId(null);
      await load(); // also refreshes clips — the server cascaded them
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete beat");
    }
  }

  // Renames ride on REST (PATCH), not GraphQL — single-field updates have
  // no field-selection story, so the graph buys nothing (mirrors the
  // server-side note on SongRestController). On success we patch local
  // state instead of re-running load(): the server confirmed exactly this
  // change, and a full reload would drop unsaved pattern edits.
  async function patchSong(patch: { title?: string; bpm?: number; timeSignature?: string }) {
    setError(null);
    try {
      await rest(`/api/songs/${songId}`, { method: "PATCH", body: patch });
      setSong((prev) => (prev ? { ...prev, ...patch } : prev));
      // A live loop keeps its scheduled step times, but the transport
      // tempo can follow immediately — the next play is fully correct.
      if (patch.bpm) Tone.getTransport().bpm.value = patch.bpm;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to update song");
    }
  }

  function changeBpm(raw: string) {
    const bpm = Number(raw);
    // Mirror the server's Song.MIN_BPM..MAX_BPM guard for a friendlier
    // message; the server still enforces it.
    if (!Number.isInteger(bpm) || bpm < 20 || bpm > 400) {
      setError("BPM must be a whole number between 20 and 400");
      return;
    }
    void patchSong({ bpm });
  }

  async function patchBeat(beatId: string, body: { name?: string; bars?: number }) {
    setError(null);
    try {
      await rest(`/api/beats/${beatId}`, { method: "PATCH", body });
      const patch = (beats: Beat[]) => beats.map((b) => (b.id === beatId ? { ...b, ...body } : b));
      beatsRef.current = patch(beatsRef.current);
      setSong((prev) => (prev ? { ...prev, beats: patch(prev.beats) } : prev));
    } catch (e) {
      // The shrink guard's message ("delete them first") surfaces here.
      setError(e instanceof ApiError ? e.message : "Failed to update beat");
    }
  }

  async function renameTrack(trackId: string, name: string) {
    setError(null);
    try {
      await rest(`/api/tracks/${trackId}`, { method: "PATCH", body: { name } });
      const patch = (beats: Beat[]) =>
        beats.map((b) => ({
          ...b,
          tracks: b.tracks.map((t) => (t.id === trackId ? { ...t, name } : t)),
        }));
      beatsRef.current = patch(beatsRef.current);
      setSong((prev) => (prev ? { ...prev, beats: patch(prev.beats) } : prev));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to rename lane");
    }
  }

  async function addTrack(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedBeatId) return;
    setError(null);
    try {
      await gql(ADD_TRACK, { input: { beatId: selectedBeatId, name: newTrackName, instrument: newInstrument } });
      setNewTrackName("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add lane");
    }
  }

  async function removeTrack(trackId: string) {
    setError(null);
    try {
      await gql(DELETE_TRACK, { id: trackId });
      instrumentsRef.current.get(trackId)?.dispose();
      instrumentsRef.current.delete(trackId);
      if (selectedId === trackId) setSelectedId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete lane");
    }
  }

  function toggleIn(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  // ---- render -------------------------------------------------------------

  if (!song) {
    return (
      <AppShell>
        {/* The skeleton mirrors the SHELL, not a stack of cards: bar on top,
            sidebar left, canvas right. Loading looks like the app it's
            becoming, so nothing jumps when the data lands. */}
        <TopBar left={<Skeleton className="h-6 w-48" />} right={<Skeleton className="h-8 w-64" />} />
        <Workspace>
          <Sidebar>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </Sidebar>
          <Canvas className="p-4">
            {error ? <ErrorBanner>{error}</ErrorBanner> : <Skeleton className="h-full w-full" />}
          </Canvas>
        </Workspace>
      </AppShell>
    );
  }

  const sortedBeats = [...song.beats].sort((a, b) => a.position - b.position);
  const selectedBeat = sortedBeats.find((b) => b.id === selectedBeatId) ?? null;
  const beatSteps = (selectedBeat?.bars ?? 1) * STEPS;
  beatStepsRef.current = beatSteps;
  const sortedLanes = selectedBeat
    ? [...selectedBeat.tracks].sort((a, b) => a.position - b.position)
    : [];
  const selected = sortedLanes.find((t) => t.id === selectedId) ?? null;
  const octave = selected ? octaves[selected.id] ?? 4 : 4;
  const selectedNotes = selected ? notesByTrack[selected.id] ?? [] : [];
  const hiddenNotes = selected
    ? selectedNotes.filter((n) => rowOf(n.pitch, octave) === null).length
    : 0;
  const currentNote =
    selected !== null && selectedNote !== null ? selectedNotes[selectedNote] ?? null : null;

  const msButton =
    "rounded border px-1.5 py-0.5 text-[0.62rem] font-bold transition-colors duration-150 cursor-pointer " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

  // Tabs pick which CANVAS is mounted; the transport, sidebar and title bar
  // are shared chrome. That's the whole reason for a shell — the frame
  // stays, only the work surface swaps.
  const tab = (id: "arrange" | "beats", label: string) => (
    <IconButton
      active={mode === id}
      className="px-3"
      onClick={() => switchMode(id)}
      title={id === "arrange" ? "Arrange the song timeline" : "Build the beats"}
    >
      {label}
    </IconButton>
  );

  return (
    <AppShell>
      <TopBar
        left={
          <>
            <Link
              to="/"
              title="Back to songs"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              ←
            </Link>
            <IconButton
              onClick={() => setSidebarCollapsed((c) => !c)}
              active={!sidebarCollapsed}
              title={sidebarCollapsed ? "Show panel" : "Hide panel"}
            >
              ☰
            </IconButton>
            <span className="min-w-0">
              <h1 className="flex items-center gap-2 truncate text-base font-bold leading-tight tracking-tight">
                {canEdit ? (
                  <EditableName
                    value={song.title}
                    maxLength={120}
                    onRename={(title) => patchSong({ title })}
                  />
                ) : (
                  song.title
                )}
                {/* Honest about the socket. When this is dark, edits are still
                    saved (the HTTP fallback) but nobody else sees them arrive —
                    which is a thing the user genuinely needs to know, so it is
                    not hidden behind a settings panel. */}
                <span
                  title={
                    live
                      ? "Live — collaborators see your edits as you make them"
                      : "Offline — edits are saved, but not shared live"
                  }
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider ${
                    live
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-edge bg-surface-2 text-muted"
                  }`}
                >
                  <i
                    className={`h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-muted"}`}
                    aria-hidden
                  />
                  {live ? "live" : "offline"}
                </span>
              </h1>
              {/* Save state lives WITH the title — it's a property of this
                  document, not a button you press. */}
              <span className="text-[0.68rem] text-muted">
                {readOnly
                  ? // NOT "you don't own this song" any more: an EDITOR doesn't
                    // own it either, and can edit it perfectly well. The thing
                    // that stops you is the ROLE, so say that.
                    "Read-only — you were invited to view this song"
                  : saving
                    ? "Saving…"
                    : dirty.size > 0
                      ? autoSave || live
                        ? `${dirty.size} unsaved · saving shortly`
                        : `${dirty.size} unsaved`
                      : "All changes saved"}
              </span>
            </span>
          </>
        }
        center={
          <>
            <ToolGroup>
              {tab("arrange", "Arrange")}
              {tab("beats", "Beats")}
            </ToolGroup>

            {/* TRANSPORT: the one primary action, flanked by the edit
                history. Grouped and sized identically — the old header had
                these as four differently-shaped buttons in a loose row. */}
            <ToolGroup>
              <IconButton onClick={undo} disabled={historySizes.past === 0} title="Undo (Ctrl+Z)">
                ↺
              </IconButton>
              <IconButton
                onClick={redo}
                disabled={historySizes.future === 0}
                title="Redo (Ctrl+Shift+Z)"
              >
                ↻
              </IconButton>
              <IconButton
                tone="solid"
                className="min-w-16"
                onClick={() => void togglePlay()}
                title={
                  mode === "arrange" ? "Play the arrangement (Space)" : "Loop the selected beat (Space)"
                }
              >
                {playing ? "■ Stop" : "▶ Play"}
              </IconButton>
            </ToolGroup>

            <ToolGroup>
              {/* Tempo and meter are DATA, so they read as data (a numeric
                  readout), not as two more buttons. Still editable —
                  double-click, same as everywhere else in the app. */}
              <Readout label="BPM">
                {canEdit ? (
                  <EditableName value={String(song.bpm)} maxLength={3} onRename={changeBpm} />
                ) : (
                  song.bpm
                )}
              </Readout>
              <Readout label="Sig">
                {canEdit ? (
                  <EditableName
                    value={song.timeSignature}
                    maxLength={5}
                    onRename={(timeSignature) => void patchSong({ timeSignature })}
                  />
                ) : (
                  song.timeSignature
                )}
              </Readout>
            </ToolGroup>
          </>
        }
        right={
          <>
            <ToolGroup>
              <label className="flex items-center gap-2 px-2" title="Master volume">
                <span aria-hidden className="text-xs">
                  🔊
                </span>
                <input
                  type="range"
                  className="w-20"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => applyVolume(Number(e.target.value))}
                />
              </label>
              <IconButton
                onClick={() => void testSound()}
                title="Play a test blip — if you can't hear this, check your tab/OS volume"
              >
                🎧
              </IconButton>
            </ToolGroup>

            {/* With auto-save on, an explicit Save button is redundant
                chrome — it only appears when you've opted out of auto-save
                (or while a save is in flight). */}
            {!readOnly && !autoSave && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void save()}
                disabled={saving || dirty.size === 0}
              >
                {saving ? "Saving…" : dirty.size > 0 ? `Save ${dirty.size}` : "Saved"}
              </Button>
            )}

            {mode === "arrange" && (
              <ToolGroup>
                <IconButton
                  onClick={() => void exportAs("wav")}
                  disabled={exporting}
                  title="Render the arrangement to a WAV file (lossless)"
                >
                  {exporting ? "…" : "WAV"}
                </IconButton>
                <IconButton
                  onClick={() => void exportAs("mp3")}
                  disabled={exporting}
                  title="Render the arrangement to an MP3 file (192 kbps)"
                >
                  {exporting ? "…" : "MP3"}
                </IconButton>
              </ToolGroup>
            )}

            <IconButton onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙
            </IconButton>
          </>
        }
      />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      <Workspace>
        {/* Folds while dragging a clip (the timeline needs the width) or
            when the user hides it by hand. */}
        <Sidebar collapsed={sidebarCollapsed || dragging}>
          {mode === "arrange" ? (
            <ArrangementPalette
              songId={song.id}
              beats={sortedBeats}
              audioFiles={audioFiles}
              armed={armed}
              onArmedChange={setArmed}
              onClipsChange={setClips}
              onAudioFilesChange={setAudioFiles}
              onError={setError}
            />
          ) : (
            <>
              {/* -- beat browser ---------------------------------------- */}
              <SidebarSection
                title="Beats"
                action={
                  canEdit ? (
                    <IconButton onClick={() => void addBeat()} title="New beat">
                      +
                    </IconButton>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-1">
                  {sortedBeats.length === 0 && (
                    <p className="text-xs text-muted">
                      A beat is a full multi-instrument groove. Create one to start.
                    </p>
                  )}
                  {sortedBeats.map((beat) => (
                    <div
                      key={beat.id}
                      className={
                        "group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150 " +
                        (beat.id === selectedBeatId
                          ? "border-accent bg-accent/15 text-text"
                          : "border-edge bg-bg-soft text-muted hover:border-edge-strong hover:text-text")
                      }
                      onClick={() => {
                        setSelectedBeatId(beat.id);
                        setSelectedId(
                          [...beat.tracks].sort((a, b) => a.position - b.position)[0]?.id ?? null,
                        );
                      }}
                    >
                      <i
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: beatColor(beat.position) }}
                      />
                      <strong className="min-w-0 flex-1 truncate font-semibold">
                        {canEdit ? (
                          <EditableName
                            value={beat.name}
                            onRename={(name) => patchBeat(beat.id, { name })}
                          />
                        ) : (
                          beat.name
                        )}
                      </strong>
                      <span className="shrink-0 text-[0.6rem] tabular-nums">
                        {beat.bars} bar{beat.bars > 1 ? "s" : ""}
                      </span>
                      {canEdit && (
                        <button
                          className="shrink-0 rounded text-muted opacity-0 transition-opacity hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover:opacity-100"
                          title="Delete beat (removes its lanes and timeline clips)"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeBeat(beat.id);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </SidebarSection>

              {/* -- lane browser (the "channel rack") -------------------- */}
              {selectedBeat && (
                <SidebarSection title={`${selectedBeat.name} · lanes`}>
                  <div className="flex flex-col gap-1">
                    {sortedLanes.length === 0 && (
                      <p className="text-xs text-muted">
                        No lanes yet — add drums below, then draw a kick in the roll.
                      </p>
                    )}
                    {sortedLanes.map((track) => {
                      const isMuted = muted.has(track.id);
                      const isSolo = soloed.has(track.id);
                      return (
                        <div
                          key={track.id}
                          className={
                            "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150 " +
                            (track.id === selectedId
                              ? "border-edge-strong bg-surface-2 text-text"
                              : "border-edge bg-bg-soft text-muted hover:border-edge-strong")
                          }
                          onClick={() => setSelectedId(track.id)}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: colorFor(track.instrument) }}
                          />
                          <strong className="min-w-0 flex-1 truncate font-semibold">
                            {canEdit ? (
                              <EditableName
                                value={track.name}
                                onRename={(name) => renameTrack(track.id, name)}
                              />
                            ) : (
                              track.name
                            )}
                          </strong>
                          <button
                            className={
                              msButton +
                              (isMuted
                                ? " border-danger bg-danger text-bg"
                                : " border-edge text-muted hover:border-edge-strong")
                            }
                            title="Mute"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMuted((prev) => toggleIn(prev, track.id));
                            }}
                          >
                            M
                          </button>
                          <button
                            className={
                              msButton +
                              (isSolo
                                ? " border-solo bg-solo text-bg"
                                : " border-edge text-muted hover:border-edge-strong")
                            }
                            title="Solo"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSoloed((prev) => toggleIn(prev, track.id));
                            }}
                          >
                            S
                          </button>
                          {canEdit && (
                            <button
                              className="shrink-0 rounded px-0.5 text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                              title="Delete lane"
                              onClick={(e) => {
                                e.stopPropagation();
                                void removeTrack(track.id);
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {canEdit && (
                  <form onSubmit={(e) => void addTrack(e)} className="mt-2 flex flex-col gap-2">
                    <TextInput
                      className="!py-1 text-xs"
                      value={newTrackName}
                      onChange={(e) => setNewTrackName(e.target.value)}
                      placeholder="808 Kick"
                      required
                      maxLength={80}
                    />
                    <div className="flex gap-2">
                      <Select
                        className="!py-1 text-xs"
                        value={newInstrument}
                        onChange={(e) => setNewInstrument(e.target.value)}
                      >
                        {["DRUMS", "BASS", "SYNTH", "PIANO", "GUITAR", "STRINGS"].map((i) => (
                          <option key={i} value={i}>
                            {i.toLowerCase()}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" size="sm">
                        Add
                      </Button>
                    </div>
                  </form>
                  )}
                </SidebarSection>
              )}
            </>
          )}
        </Sidebar>

        {/* ---- CANVAS -------------------------------------------------- */}
        {mode === "arrange" ? (
          <Canvas>
            {error && (
              <div className="px-4 pt-4">
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}
            <ArrangementTimeline
              songId={song.id}
              bpm={song.bpm}
              beats={sortedBeats}
              audioFiles={audioFiles}
              clips={clips}
              onClipsChange={setClips}
              armed={armed}
              onArmedChange={setArmed}
              playheadStep={arrangeStep}
              onError={setError}
              onDraggingChange={setDragging}
              onOpenBeat={(beatId) => {
                setSelectedBeatId(beatId);
                const beat = sortedBeats.find((b) => b.id === beatId);
                setSelectedId(beat?.tracks[0]?.id ?? null);
                switchMode("beats");
              }}
            />
          </Canvas>
        ) : (
          <Canvas>
            {/* The contextual strip: what you can do to THIS beat / THIS
                note. Everything global already lives in the transport. */}
            {selectedBeat && (
              <CanvasBar>
                <span className="text-sm font-bold tracking-tight">
                  {selected ? selected.name : selectedBeat.name}
                </span>
                {selected && (
                  <span className="text-xs text-muted">{selected.instrument.toLowerCase()}</span>
                )}

                <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                  length
                  <Select
                    className="!w-auto !py-0.5 text-xs"
                    value={selectedBeat.bars}
                    disabled={!canEdit}
                    onChange={(e) => void patchBeat(selectedBeat.id, { bars: Number(e.target.value) })}
                  >
                    {[1, 2, 4, 8].map((b) => (
                      <option key={b} value={b}>
                        {b} bar{b > 1 ? "s" : ""}
                      </option>
                    ))}
                  </Select>
                </label>

                {selected && (
                  <ToolGroup>
                    <IconButton
                      onClick={() =>
                        setOctaves((p) => ({ ...p, [selected.id]: Math.max(0, octave - 1) }))
                      }
                      title="Octave down"
                    >
                      −
                    </IconButton>
                    <span className="px-1 font-mono text-xs tabular-nums text-muted">
                      oct {octave}
                    </span>
                    <IconButton
                      onClick={() =>
                        setOctaves((p) => ({ ...p, [selected.id]: Math.min(7, octave + 1) }))
                      }
                      title="Octave up"
                    >
                      +
                    </IconButton>
                  </ToolGroup>
                )}

                {/* Velocity only exists when a note is selected — a control
                    with nothing to control is noise, so it isn't rendered. */}
                {currentNote && selected && (
                  <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted">
                    vel {Math.round(currentNote.velocity * 100)}%
                    <input
                      type="range"
                      className="w-24"
                      min={10}
                      max={100}
                      value={Math.round(currentNote.velocity * 100)}
                      onPointerDown={recordHistory}
                      onChange={(e) => {
                        const velocity = Number(e.target.value) / 100;
                        updateNote(selected.id, selectedNote!, { velocity });
                        preview(selected.id, currentNote.pitch, velocity);
                      }}
                    />
                  </label>
                )}

                {hiddenNotes > 0 && (
                  <span className="text-xs text-muted">{hiddenNotes} note(s) in other octaves</span>
                )}
              </CanvasBar>
            )}

            {error && (
              <div className="px-4 pt-4">
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}

            {!selectedBeat ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon="🧱"
                  title="No beats yet"
                  hint='A beat is a full multi-instrument groove — "Beat 1" with kick, snare and bass lanes. Create one in the left panel, build it here, then place it on the Arrange timeline.'
                />
              </div>
            ) : !selected ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon="🥁"
                  title="No lanes in this beat"
                  hint="Add a drums lane in the left panel, then click cells here to lay down your first kick pattern."
                />
              </div>
            ) : (
              // ONE horizontal scroll box holds the roll AND the channel
              // rack, so they scroll together and stay column-aligned. At 8
              // bars the grid is 128 steps (~4300px) wide: it must scroll
              // INSIDE this box, not blow the page open — which is what made
              // the 8-bar view "scale" into something unusable.
              // `max-w-full min-w-0` is what actually constrains it to the
              // canvas; without them a flex/grid child sizes to its content
              // and the box would just grow instead of scrolling.
              <div className="flex min-w-0 flex-col p-4">
                <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-edge bg-bg-soft p-2">
                  <div className="w-max select-none">
                    {/* -- piano roll ------------------------------------ */}
                    <div className="flex">
                      {/* The pitch gutter is sticky: scroll to bar 7 and you
                          can still tell a C from an F#. */}
                      <div className="sticky left-0 z-2 w-11 shrink-0 bg-bg-soft text-[0.68rem] text-muted">
                        {PITCH_ROWS.map((p) => (
                          <div
                            key={p}
                            style={{ height: CELL_H }}
                            className={
                              "flex items-center justify-end pr-2" +
                              (p.includes("#") ? " text-muted/50" : "")
                            }
                          >
                            {p}
                            {octave}
                          </div>
                        ))}
                      </div>
                      <div
                        className="roll"
                        ref={rollRef}
                        onMouseDown={canEdit ? onRollMouseDown : undefined}
                        style={{ width: beatSteps * CELL_W, height: PITCH_ROWS.length * CELL_H }}
                      >
                        {PITCH_ROWS.map((p, row) =>
                          Array.from({ length: beatSteps }, (_, col) => (
                            <div
                              key={`${row}-${col}`}
                              className={[
                                "roll-cell",
                                p.includes("#") ? "dark" : "",
                                col % 16 === 0 ? "bar" : col % 4 === 0 ? "beat" : "",
                                col === currentStep ? "playcol" : "",
                              ].join(" ")}
                              style={{
                                left: col * CELL_W,
                                top: row * CELL_H,
                                width: CELL_W,
                                height: CELL_H,
                              }}
                            />
                          )),
                        )}
                        {selectedNotes.map((note, index) => {
                          const row = rowOf(note.pitch, octave);
                          if (row === null) return null;
                          return (
                            <div
                              key={index}
                              className={`note ${index === selectedNote ? "selected" : ""}`}
                              style={
                                {
                                  left: note.step * CELL_W + 1,
                                  top: row * CELL_H + 2,
                                  width: note.length * CELL_W - 3,
                                  height: CELL_H - 4,
                                  // Velocity is VISIBLE: quiet notes are translucent.
                                  opacity: 0.35 + 0.65 * note.velocity,
                                  "--tc": colorFor(selected.instrument),
                                } as React.CSSProperties
                              }
                              onMouseDown={
                                canEdit ? (e) => onNoteMouseDown(e, index, note, false) : undefined
                              }
                              onContextMenu={
                                canEdit ? (e) => onNoteContextMenu(e, index) : undefined
                              }
                            >
                              {canEdit && (
                                <span
                                  className="note-handle"
                                  onMouseDown={(e) => onNoteMouseDown(e, index, note, true)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* -- channel rack: every lane of this beat at a glance.
                           Cells are sized from CELL_W so its columns line up
                           with the roll above — a rack that drifts out of
                           alignment is worse than no rack. --------------- */}
                    <div className="mt-3 flex flex-col gap-1 border-t border-edge pt-3">
                      {sortedLanes.map((track) => {
                        const notes = notesByTrack[track.id] ?? [];
                        return (
                          <div
                            key={track.id}
                            className={
                              "flex cursor-pointer items-center rounded transition-colors duration-150 " +
                              (track.id === selectedId ? "bg-surface-2" : "hover:bg-surface-2/60")
                            }
                            onClick={() => setSelectedId(track.id)}
                          >
                            <span className="sticky left-0 z-2 flex w-11 shrink-0 items-center gap-1 bg-bg-soft pr-1">
                              <i
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ background: colorFor(track.instrument) }}
                                title={track.name}
                              />
                              <span className="truncate text-[0.6rem] font-semibold text-muted">
                                {track.name}
                              </span>
                            </span>
                            <div
                              className="flex"
                              style={{ "--tc": colorFor(track.instrument) } as React.CSSProperties}
                            >
                              {Array.from({ length: beatSteps }, (_, s) => (
                                <span
                                  key={s}
                                  className={[
                                    "cell",
                                    notes.some((n) => s >= n.step && s < n.step + n.length)
                                      ? "on"
                                      : "",
                                    s === currentStep ? "playhead" : "",
                                    s % 16 === 0 ? "bar" : s % 4 === 0 ? "beat" : "",
                                  ].join(" ")}
                                  style={{ width: CELL_W - 3, height: 16, marginRight: 3 }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Canvas>
        )}
      </Workspace>
    </AppShell>
  );
}
