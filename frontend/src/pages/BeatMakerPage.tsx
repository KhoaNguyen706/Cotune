import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Tone from "tone";
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
import { ArrangementPanel } from "../components/ArrangementPanel";
import { beatColor, colorFor } from "../ui/trackColors";
import { Button, Card, EditableName, EmptyState, ErrorBanner, Field, Select, Skeleton, TextInput } from "../ui/kit";
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
      id title bpm timeSignature
      beats {
        id name position
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
  const [song, setSong] = useState<Song | null>(null);
  // Two editors, one page: "arrange" is the song timeline (clips place
  // whole beats), "beats" is where you build each beat — pick Beat 1/2/3,
  // edit its instrument lanes. One transport serves both.
  const [mode, setMode] = useState<"arrange" | "beats">("arrange");
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [notesByTrack, setNotesByTrack] = useState<Record<string, Step[]>>({});
  const [clips, setClips] = useState<Clip[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
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
  const [newBeatName, setNewBeatName] = useState("");
  const [newTrackName, setNewTrackName] = useState("");
  const [newInstrument, setNewInstrument] = useState("DRUMS");

  // Mutable, non-rendering machinery lives in refs (see Session 5 notes on
  // stale closures): the transport callback and drag handlers are created
  // once but must always see current data.
  const instrumentsRef = useRef<Map<string, TrackInstrument>>(new Map());
  const notesRef = useRef(notesByTrack);
  notesRef.current = notesByTrack;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const beatsRef = useRef<Beat[]>([]);
  // Last-known @Version per lane, sent back as expectedVersion on save.
  const trackVersionsRef = useRef<Map<string, number>>(new Map());
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
    const col = Math.max(0, Math.min(STEPS - 1, Math.floor((e.clientX - rect.left) / CELL_W)));
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

    setNotesByTrack((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), { step: col, pitch, velocity: 0.9, length: 1 }],
    }));
    setDirty((prev) => new Set(prev).add(selectedId));
    preview(selectedId, pitch);
    // FL-style: the fresh note is immediately in resize mode — press,
    // drag right, release = a note exactly as long as you dragged.
    dragRef.current = { trackId: selectedId, index: notes.length, mode: "resize", grabOffset: 0, rect, moved: false };
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
    };
  }

  function onNoteContextMenu(e: React.MouseEvent, index: number) {
    // Right-click deletes — the DAW convention.
    e.preventDefault();
    if (!selectedId) return;
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
        const length = Math.max(1, Math.min(STEPS - note.step, col - note.step + 1));
        if (length !== note.length) {
          drag.moved = true;
          updateNote(drag.trackId, drag.index, { length });
        }
      } else {
        const octave = octavesRef.current[drag.trackId] ?? 4;
        const step = Math.max(0, Math.min(STEPS - note.length, col - drag.grabOffset));
        const pitch = pitchOf(row, octave);
        if (step !== note.step || pitch !== note.pitch) {
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
      const current = step % STEPS;
      const sixteenth = Tone.Time("16n").toSeconds();
      // Loop the SELECTED beat only — this view is the beat workbench;
      // hearing the whole song is what the Arrange tab is for.
      const looping = beatsRef.current.find((b) => b.id === selectedBeatIdRef.current);
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
          setNotesByTrack((prev) => ({
            ...prev,
            [trackId]: (prev[trackId] ?? []).filter((_, i) => i !== index),
          }));
          setDirty((prev) => new Set(prev).add(trackId));
          setSelectedNote(null);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function save() {
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
      }
      setDirty(new Set());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Conservative conflict resolution for now: reload the server's
        // truth. Merging concurrent edits is the collaboration phase.
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

  async function addBeat(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const name = newBeatName.trim() || `Beat ${beatsRef.current.length + 1}`;
      const data = await gql<{ addBeat: { id: string } }>(ADD_BEAT, { input: { songId, name } });
      setNewBeatName("");
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

  async function renameBeat(beatId: string, name: string) {
    setError(null);
    try {
      await rest(`/api/beats/${beatId}`, { method: "PATCH", body: { name } });
      const patch = (beats: Beat[]) => beats.map((b) => (b.id === beatId ? { ...b, name } : b));
      beatsRef.current = patch(beatsRef.current);
      setSong((prev) => (prev ? { ...prev, beats: patch(prev.beats) } : prev));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to rename beat");
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
      <main className="w-full max-w-6xl">
        {error ? (
          <ErrorBanner>{error}</ErrorBanner>
        ) : (
          // Skeleton mirrors the real layout: header row, beat list, roll.
          <>
            <div className="mb-6 flex items-center justify-between">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-8 w-64" />
            </div>
            <Card className="mb-4">
              <div className="flex flex-col gap-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            </Card>
            <Card>
              <Skeleton className="h-64 w-full" />
            </Card>
          </>
        )}
      </main>
    );
  }

  const sortedBeats = [...song.beats].sort((a, b) => a.position - b.position);
  const selectedBeat = sortedBeats.find((b) => b.id === selectedBeatId) ?? null;
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
    "rounded border px-2 py-0.5 text-[0.68rem] font-bold transition-colors duration-150 cursor-pointer " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

  const tabButton = (tab: "arrange" | "beats", label: string) => (
    <button
      className={
        "rounded-md px-4 py-1 text-sm font-semibold transition-colors duration-150 cursor-pointer " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
        (mode === tab ? "bg-surface-2 text-text" : "text-muted hover:text-text")
      }
      onClick={() => switchMode(tab)}
    >
      {label}
    </button>
  );

  return (
    <main className="w-full max-w-6xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            className="rounded text-xs text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            to="/"
          >
            ← Songs
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight">
            <EditableName value={song.title} maxLength={120} onRename={(title) => patchSong({ title })} />
          </h1>
          <span className="text-sm text-muted">
            <EditableName value={String(song.bpm)} maxLength={3} onRename={changeBpm} />
            {" BPM · "}
            <EditableName
              value={song.timeSignature}
              maxLength={5}
              onRename={(timeSignature) => void patchSong({ timeSignature })}
            />
          </span>
        </div>

        <div className="flex rounded-lg border border-edge bg-bg-soft p-1">
          {tabButton("arrange", "Arrange")}
          {tabButton("beats", "Beats")}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm" title="Master volume">
            <span aria-hidden>🔊</span>
            <input
              type="range"
              className="w-24"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => applyVolume(Number(e.target.value))}
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void testSound()}
            title="Play a test blip — if you can't hear this, check your tab/OS volume"
          >
            Test
          </Button>
          <Button
            className="min-w-24"
            onClick={() => void togglePlay()}
            title={mode === "arrange" ? "Play the arrangement" : "Loop the selected beat"}
          >
            {playing ? "■ Stop" : "▶ Play"}
          </Button>
          <Button variant="ghost" onClick={() => void save()} disabled={saving || dirty.size === 0}>
            {saving ? "Saving…" : dirty.size > 0 ? `Save (${dirty.size})` : "Saved"}
          </Button>
          {mode === "arrange" && (
            <>
              <Button
                variant="ghost"
                onClick={() => void exportAs("wav")}
                disabled={exporting}
                title="Render the arrangement to a WAV file (lossless)"
              >
                {exporting ? "Rendering…" : "⬇ WAV"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void exportAs("mp3")}
                disabled={exporting}
                title="Render the arrangement to an MP3 file (192 kbps)"
              >
                {exporting ? "Rendering…" : "⬇ MP3"}
              </Button>
            </>
          )}
        </div>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {mode === "arrange" && (
        <Card className="mb-4">
          <ArrangementPanel
            songId={song.id}
            bpm={song.bpm}
            beats={sortedBeats}
            audioFiles={audioFiles}
            clips={clips}
            onClipsChange={setClips}
            onAudioFilesChange={setAudioFiles}
            playheadStep={arrangeStep}
            onError={setError}
            onOpenBeat={(beatId) => {
              setSelectedBeatId(beatId);
              const beat = sortedBeats.find((b) => b.id === beatId);
              setSelectedId(beat?.tracks[0]?.id ?? null);
              switchMode("beats");
            }}
          />
        </Card>
      )}

      {mode === "beats" && (
        <>
          {/* -- beat selector: Beat 1 | Beat 2 | ... | + new ------------- */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              {sortedBeats.map((beat) => (
                <span
                  key={beat.id}
                  className={
                    "inline-flex cursor-pointer items-center gap-2 rounded-full border px-2 py-1 text-sm font-semibold transition-colors duration-150 " +
                    (beat.id === selectedBeatId
                      ? "border-edge-strong bg-surface-2 text-text"
                      : "border-edge text-muted hover:border-edge-strong")
                  }
                  onClick={() => {
                    setSelectedBeatId(beat.id);
                    setSelectedId(
                      [...beat.tracks].sort((a, b) => a.position - b.position)[0]?.id ?? null,
                    );
                  }}
                >
                  <i className="h-2.5 w-2.5 rounded-full" style={{ background: beatColor(beat.position) }} />
                  <EditableName value={beat.name} onRename={(name) => renameBeat(beat.id, name)} />
                  <button
                    className="rounded text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    title="Delete beat (removes its lanes and timeline clips)"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeBeat(beat.id);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <form onSubmit={(e) => void addBeat(e)} className="ml-auto flex items-center gap-2">
                <TextInput
                  className="w-40 !py-1 text-sm"
                  value={newBeatName}
                  onChange={(e) => setNewBeatName(e.target.value)}
                  placeholder={`Beat ${sortedBeats.length + 1}`}
                  maxLength={80}
                />
                <Button type="submit" size="sm">+ Beat</Button>
              </form>
            </div>
            {sortedBeats.length === 0 && (
              <EmptyState
                icon="🧱"
                title="No beats yet"
                hint='A beat is a full multi-instrument groove — "Beat 1" with kick, snare and bass lanes. Create one above, build it below, then place it on the Arrange timeline.'
              />
            )}
          </Card>

          {selectedBeat && (
            <Card className="mb-4">
              <h2 className="mb-4 font-semibold">
                {selectedBeat.name} — lanes
                <span className="ml-2 text-xs font-normal text-muted">
                  these instruments play together as one beat
                </span>
              </h2>
              {sortedLanes.length === 0 && (
                <EmptyState
                  icon="🥁"
                  title="No lanes in this beat"
                  hint="Add a drums lane below, then click cells in the piano roll to lay down your first kick pattern."
                />
              )}
              <div className="flex flex-col gap-2">
                {sortedLanes.map((track) => {
                  const notes = notesByTrack[track.id] ?? [];
                  const isMuted = muted.has(track.id);
                  const isSolo = soloed.has(track.id);
                  return (
                    <div
                      key={track.id}
                      className={
                        "flex items-center gap-4 rounded-lg border px-2 py-1 cursor-pointer transition-colors duration-150 " +
                        (track.id === selectedId
                          ? "border-edge-strong bg-surface-2"
                          : "border-transparent hover:bg-surface-2")
                      }
                      onClick={() => setSelectedId(track.id)}
                    >
                      <div className="flex w-48 shrink-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: colorFor(track.instrument) }}
                        />
                        <strong className="truncate text-sm">
                          <EditableName value={track.name} onRename={(name) => renameTrack(track.id, name)} />
                        </strong>
                        <span className="text-xs text-muted">{track.instrument.toLowerCase()}</span>
                        <span className="ml-auto inline-flex gap-1">
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
                        </span>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeTrack(track.id);
                          }}
                        >
                          ×
                        </Button>
                      </div>
                      <div
                        className="seq-cells mini"
                        style={{ "--tc": colorFor(track.instrument) } as React.CSSProperties}
                      >
                        {Array.from({ length: STEPS }, (_, s) => (
                          <span
                            key={s}
                            className={[
                              "cell",
                              notes.some((n) => s >= n.step && s < n.step + n.length) ? "on" : "",
                              s === currentStep ? "playhead" : "",
                              s % 4 === 0 ? "beat" : "",
                            ].join(" ")}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {selected && (
            <Card className="mb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{selected.name} — piano roll</h2>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOctaves((p) => ({ ...p, [selected.id]: Math.max(0, octave - 1) }))}
                  >
                    Oct −
                  </Button>
                  <span>octave {octave}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOctaves((p) => ({ ...p, [selected.id]: Math.min(7, octave + 1) }))}
                  >
                    Oct +
                  </Button>
                  {currentNote && (
                    <label className="flex items-center gap-2 whitespace-nowrap text-xs">
                      velocity {Math.round(currentNote.velocity * 100)}%
                      <input
                        type="range"
                        className="w-32"
                        min={10}
                        max={100}
                        value={Math.round(currentNote.velocity * 100)}
                        onChange={(e) => {
                          const velocity = Number(e.target.value) / 100;
                          updateNote(selected.id, selectedNote!, { velocity });
                          preview(selected.id, currentNote.pitch, velocity);
                        }}
                      />
                    </label>
                  )}
                  {hiddenNotes > 0 && <span className="text-xs">{hiddenNotes} note(s) in other octaves</span>}
                </div>
              </div>
              <p className="mt-2 mb-4 text-xs text-muted">
                Click empty cell = add note (keep dragging to stretch) · drag note = move (up/down =
                pitch) · right edge = resize · click note = select, then slide velocity or press
                Delete · right-click = delete · Space = play/stop.
              </p>
              <div className="flex select-none overflow-x-auto rounded-lg">
                <div className="w-11 shrink-0 text-[0.68rem] text-muted">
                  {PITCH_ROWS.map((p) => (
                    <div
                      key={p}
                      style={{ height: CELL_H }}
                      className={
                        "flex items-center justify-end pr-2" + (p.includes("#") ? " text-muted/50" : "")
                      }
                    >
                      {p}{octave}
                    </div>
                  ))}
                </div>
                <div
                  className="roll"
                  ref={rollRef}
                  onMouseDown={onRollMouseDown}
                  style={{ width: STEPS * CELL_W, height: PITCH_ROWS.length * CELL_H }}
                >
                  {PITCH_ROWS.map((p, row) =>
                    Array.from({ length: STEPS }, (_, col) => (
                      <div
                        key={`${row}-${col}`}
                        className={[
                          "roll-cell",
                          p.includes("#") ? "dark" : "",
                          col % 4 === 0 ? "beat" : "",
                          col === currentStep ? "playcol" : "",
                        ].join(" ")}
                        style={{ left: col * CELL_W, top: row * CELL_H, width: CELL_W, height: CELL_H }}
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
                        style={{
                          left: note.step * CELL_W + 1,
                          top: row * CELL_H + 2,
                          width: note.length * CELL_W - 3,
                          height: CELL_H - 4,
                          // Velocity is VISIBLE: quiet notes are translucent.
                          opacity: 0.35 + 0.65 * note.velocity,
                          "--tc": colorFor(selected.instrument),
                        } as React.CSSProperties}
                        onMouseDown={(e) => onNoteMouseDown(e, index, note, false)}
                        onContextMenu={(e) => onNoteContextMenu(e, index)}
                      >
                        <span
                          className="note-handle"
                          onMouseDown={(e) => onNoteMouseDown(e, index, note, true)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          {selectedBeat && (
            <Card>
              <h2 className="mb-4 font-semibold">Add lane to {selectedBeat.name}</h2>
              <form onSubmit={(e) => void addTrack(e)} className="flex flex-wrap items-end gap-4">
                <div className="min-w-48 flex-1">
                  <Field label="Name">
                    <TextInput
                      value={newTrackName}
                      onChange={(e) => setNewTrackName(e.target.value)}
                      placeholder="808 Kick"
                      required
                      maxLength={80}
                    />
                  </Field>
                </div>
                <div className="w-36">
                  <Field label="Instrument">
                    <Select value={newInstrument} onChange={(e) => setNewInstrument(e.target.value)}>
                      {["DRUMS", "BASS", "SYNTH", "PIANO", "GUITAR", "STRINGS"].map((i) => (
                        <option key={i} value={i}>{i.toLowerCase()}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button type="submit">Add</Button>
              </form>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
