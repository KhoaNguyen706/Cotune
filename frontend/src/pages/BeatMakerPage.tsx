import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Tone from "tone";
import { ApiError, gql } from "../api/client";
import { createInstrument, type TrackInstrument } from "../audio/instruments";
import { colorFor } from "../ui/trackColors";
import type { Song, Step, Track } from "../types";

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
      tracks { id name instrument position pattern { step pitch velocity length } }
    }
  }
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
  mutation SavePattern($id: ID!, $pattern: [StepInput!]!) {
    updateTrackPattern(id: $id, pattern: $pattern) { id version }
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
  const [notesByTrack, setNotesByTrack] = useState<Record<string, Step[]>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [octaves, setOctaves] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [soloed, setSoloed] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newTrackName, setNewTrackName] = useState("");
  const [newInstrument, setNewInstrument] = useState("DRUMS");

  // Mutable, non-rendering machinery lives in refs (see Session 5 notes on
  // stale closures): the transport callback and drag handlers are created
  // once but must always see current data.
  const instrumentsRef = useRef<Map<string, TrackInstrument>>(new Map());
  const notesRef = useRef(notesByTrack);
  notesRef.current = notesByTrack;
  const tracksRef = useRef<Track[]>([]);
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
      tracksRef.current = data.song.tracks;
      const next: Record<string, Step[]> = {};
      for (const track of data.song.tracks) {
        next[track.id] = track.pattern;
        if (!instrumentsRef.current.has(track.id)) {
          instrumentsRef.current.set(track.id, createInstrument(track.instrument));
        }
      }
      setNotesByTrack(next);
      setOctaves((prev) => {
        const merged = { ...prev };
        for (const track of data.song.tracks) {
          merged[track.id] ??= instrumentsRef.current.get(track.id)!.defaultOctave;
        }
        return merged;
      });
      setSelectedId((prev) => prev ?? data.song.tracks[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load song");
    }
  }, [songId]);

  useEffect(() => {
    void load();
    const instruments = instrumentsRef.current;
    return () => {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      instruments.forEach((i) => i.dispose());
      instruments.clear();
    };
  }, [load]);

  // Unsaved work guard: the browser shows a "leave site?" prompt while any
  // track is dirty. Cheap insurance against losing a beat to a reflexive
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

  async function togglePlay() {
    if (!song) return;
    if (playing) {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      setPlaying(false);
      setCurrentStep(-1);
      return;
    }
    // Pressing play on a silent song is the #1 "sound is broken" report —
    // say why instead of sweeping an empty playhead in silence.
    const totalNotes = Object.values(notesRef.current).reduce((n, list) => n + list.length, 0);
    if (totalNotes === 0) {
      setError("This song has no notes yet — click cells in the piano roll below, then press play.");
      return;
    }
    await Tone.start();
    Tone.getTransport().bpm.value = song.bpm;
    let step = 0;
    Tone.getTransport().scheduleRepeat((time) => {
      const current = step % STEPS;
      const sixteenth = Tone.Time("16n").toSeconds();
      for (const track of tracksRef.current) {
        // Solo wins over mute, DAW-standard: if ANY track is soloed, only
        // soloed tracks sound; otherwise everything not muted sounds.
        const audible = soloedRef.current.size > 0
          ? soloedRef.current.has(track.id)
          : !mutedRef.current.has(track.id);
        if (!audible) continue;
        for (const note of notesRef.current[track.id] ?? []) {
          if (note.step === current) {
            // try/catch PER NOTE: monophonic synths (drums, bass) throw on
            // two notes at the exact same tick ("start time must be
            // strictly greater..."). Without isolation, one bad chord on
            // track 1 would silence every later track on that tick, every
            // loop — which users report as "play is broken".
            try {
              instrumentsRef.current
                .get(track.id)
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
        await gql(SAVE_PATTERN, { id: trackId, pattern });
      }
      setDirty(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addTrack(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await gql(ADD_TRACK, { input: { songId, name: newTrackName, instrument: newInstrument } });
      setNewTrackName("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add track");
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
      setError(e instanceof ApiError ? e.message : "Failed to delete track");
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
      <main className="wide">{error ? <p className="error">{error}</p> : <p>Loading…</p>}</main>
    );
  }

  const sortedTracks = [...song.tracks].sort((a, b) => a.position - b.position);
  const selected = sortedTracks.find((t) => t.id === selectedId) ?? null;
  const octave = selected ? octaves[selected.id] ?? 4 : 4;
  const selectedNotes = selected ? notesByTrack[selected.id] ?? [] : [];
  const hiddenNotes = selected
    ? selectedNotes.filter((n) => rowOf(n.pitch, octave) === null).length
    : 0;
  const currentNote =
    selected !== null && selectedNote !== null ? selectedNotes[selectedNote] ?? null : null;

  return (
    <main className="wide">
      <header className="topbar">
        <div>
          <Link to="/">← Songs</Link>
          <h1>{song.title}</h1>
          <span className="who">{song.bpm} BPM · {song.timeSignature}</span>
        </div>
        <div className="transport">
          <label className="volume" title="Master volume">
            🔊
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => applyVolume(Number(e.target.value))}
            />
          </label>
          <button className="ghost" onClick={() => void testSound()} title="Play a test blip — if you can't hear this, check your tab/OS volume">
            Test
          </button>
          <button onClick={() => void togglePlay()}>{playing ? "■ Stop" : "▶ Play"}</button>
          <button onClick={() => void save()} disabled={saving || dirty.size === 0}>
            {saving ? "Saving…" : dirty.size > 0 ? `Save (${dirty.size})` : "Saved"}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="card tracklist">
        {sortedTracks.length === 0 && <p>No tracks yet — add one below, then paint notes.</p>}
        {sortedTracks.map((track) => {
          const notes = notesByTrack[track.id] ?? [];
          const isMuted = muted.has(track.id);
          const isSolo = soloed.has(track.id);
          return (
            <div
              key={track.id}
              className={`seq-row ${track.id === selectedId ? "selected" : ""}`}
              onClick={() => setSelectedId(track.id)}
            >
              <div className="seq-label">
                <span className="dot" style={{ background: colorFor(track.instrument) }} />
                <strong>{track.name}</strong>
                <span className="inst">{track.instrument.toLowerCase()}</span>
                <span className="ms">
                  <button
                    className={`ms-btn ${isMuted ? "active-m" : ""}`}
                    title="Mute"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMuted((prev) => toggleIn(prev, track.id));
                    }}
                  >
                    M
                  </button>
                  <button
                    className={`ms-btn ${isSolo ? "active-s" : ""}`}
                    title="Solo"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSoloed((prev) => toggleIn(prev, track.id));
                    }}
                  >
                    S
                  </button>
                </span>
                <button
                  className="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeTrack(track.id);
                  }}
                >
                  ×
                </button>
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
      </section>

      {selected && (
        <section className="card">
          <div className="roll-head">
            <h2>{selected.name} — piano roll</h2>
            <div className="roll-controls">
              <button onClick={() => setOctaves((p) => ({ ...p, [selected.id]: Math.max(0, octave - 1) }))}>
                Oct −
              </button>
              <span>octave {octave}</span>
              <button onClick={() => setOctaves((p) => ({ ...p, [selected.id]: Math.min(7, octave + 1) }))}>
                Oct +
              </button>
              {currentNote && (
                <label className="velocity">
                  velocity {Math.round(currentNote.velocity * 100)}%
                  <input
                    type="range"
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
              {hiddenNotes > 0 && <span className="who">{hiddenNotes} note(s) in other octaves</span>}
            </div>
          </div>
          <p className="hint">
            Click empty cell = add note (keep dragging to stretch) · drag note = move (up/down =
            pitch) · right edge = resize · click note = select, then slide velocity or press
            Delete · right-click = delete · Space = play/stop.
          </p>
          <div className="roll-wrap">
            <div className="pitch-labels">
              {PITCH_ROWS.map((p) => (
                <div key={p} style={{ height: CELL_H }} className={p.includes("#") ? "dark" : ""}>
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
        </section>
      )}

      <section className="card">
        <h2>Add track</h2>
        <form onSubmit={(e) => void addTrack(e)} className="row">
          <label>
            Name
            <input value={newTrackName} onChange={(e) => setNewTrackName(e.target.value)} required maxLength={80} />
          </label>
          <label>
            Instrument
            <select value={newInstrument} onChange={(e) => setNewInstrument(e.target.value)}>
              {["DRUMS", "BASS", "SYNTH", "PIANO", "GUITAR", "STRINGS"].map((i) => (
                <option key={i} value={i}>{i.toLowerCase()}</option>
              ))}
            </select>
          </label>
          <button type="submit">Add</button>
        </form>
      </section>
    </main>
  );
}
