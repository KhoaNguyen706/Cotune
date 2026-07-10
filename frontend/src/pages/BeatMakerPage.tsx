import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Tone from "tone";
import { ApiError, gql } from "../api/client";
import { createInstrument, type TrackInstrument } from "../audio/instruments";
import type { Song, Step, Track } from "../types";

const STEPS = 16;

const SONG_QUERY = `
  query Song($id: ID!) {
    song(id: $id) {
      id title bpm timeSignature
      tracks { id name instrument position pattern { step pitch velocity } }
    }
  }
`;

const ADD_TRACK = `
  mutation AddTrack($input: AddTrackInput!) {
    addTrack(input: $input) { id name instrument position pattern { step pitch velocity } }
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

/** Grid cell truth: is there an event at this step? (MVP: one row per track,
 *  the instrument's default pitch — the DATA model already supports chords
 *  and melodies; only this editor is drum-machine-shaped.) */
function toGrid(pattern: Step[]): boolean[] {
  const row = Array<boolean>(STEPS).fill(false);
  for (const event of pattern) {
    if (event.step >= 0 && event.step < STEPS) row[event.step] = true;
  }
  return row;
}

export function BeatMakerPage() {
  const { songId } = useParams<{ songId: string }>();
  const [song, setSong] = useState<Song | null>(null);
  const [grids, setGrids] = useState<Record<string, boolean[]>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newTrackName, setNewTrackName] = useState("");
  const [newInstrument, setNewInstrument] = useState("DRUMS");

  // Audio objects live OUTSIDE React state: synths and the paint gesture
  // are mutable, non-rendering machinery. Putting them in useState would
  // re-render on every note and fight React's lifecycle; refs are the
  // escape hatch React provides for exactly this.
  const instrumentsRef = useRef<Map<string, TrackInstrument>>(new Map());
  const gridsRef = useRef(grids);
  gridsRef.current = grids;
  const tracksRef = useRef<Track[]>([]);
  const paintRef = useRef<boolean | null>(null); // null = not dragging

  const load = useCallback(async () => {
    try {
      const data = await gql<{ song: Song }>(SONG_QUERY, { id: songId });
      setSong(data.song);
      tracksRef.current = data.song.tracks;
      const nextGrids: Record<string, boolean[]> = {};
      for (const track of data.song.tracks) {
        nextGrids[track.id] = toGrid(track.pattern);
        if (!instrumentsRef.current.has(track.id)) {
          instrumentsRef.current.set(track.id, createInstrument(track.instrument));
        }
      }
      setGrids(nextGrids);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load song");
    }
  }, [songId]);

  useEffect(() => {
    void load();
    const instruments = instrumentsRef.current;
    // Cleanup: stop transport and release WebAudio nodes when leaving the
    // page — otherwise navigating back and forth stacks silent synths
    // until the audio context runs out of headroom.
    return () => {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      instruments.forEach((i) => i.dispose());
      instruments.clear();
    };
  }, [load]);

  // End a paint-drag wherever the mouse is released, even outside the grid.
  useEffect(() => {
    const stop = () => (paintRef.current = null);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  function setCell(trackId: string, step: number, on: boolean, preview: boolean) {
    setGrids((prev) => {
      const row = [...(prev[trackId] ?? Array(STEPS).fill(false))];
      if (row[step] === on) return prev;
      row[step] = on;
      return { ...prev, [trackId]: row };
    });
    setDirty((prev) => new Set(prev).add(trackId));
    if (on && preview) {
      // Immediate feedback on placing a note — "drag note, it makes a
      // sound". time=undefined means "now" (outside transport scheduling).
      const instrument = instrumentsRef.current.get(trackId);
      instrument?.trigger(undefined, instrument.defaultPitch, 0.9);
    }
  }

  function onCellMouseDown(trackId: string, step: number) {
    const on = !(gridsRef.current[trackId]?.[step] ?? false);
    paintRef.current = on; // this drag paints cells to the toggled value
    setCell(trackId, step, on, true);
  }

  function onCellMouseEnter(trackId: string, step: number) {
    if (paintRef.current === null) return;
    setCell(trackId, step, paintRef.current, true);
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
    // Browsers block audio until a user gesture — Tone.start() must be
    // called from a click handler, which is why play can't autostart.
    await Tone.start();
    Tone.getTransport().bpm.value = song.bpm;
    let step = 0;
    Tone.getTransport().scheduleRepeat((time) => {
      const current = step % STEPS;
      // Read through refs, not state: this callback was created once, and
      // closing over `grids` state would freeze the beat as it was at
      // play-time. Refs always see the latest grid — edit WHILE playing.
      for (const track of tracksRef.current) {
        if (gridsRef.current[track.id]?.[current]) {
          const instrument = instrumentsRef.current.get(track.id);
          instrument?.trigger(time, instrument.defaultPitch, 0.9);
        }
      }
      // Tone.Draw syncs visuals to AUDIO time — the audio thread schedules
      // ahead of the wall clock, so setting state directly here would
      // highlight cells before they sound.
      Tone.getDraw().schedule(() => setCurrentStep(current), time);
      step++;
    }, "16n");
    Tone.getTransport().start();
    setPlaying(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // One mutation per dirty track — only what changed travels.
      for (const trackId of dirty) {
        const track = tracksRef.current.find((t) => t.id === trackId);
        const instrument = instrumentsRef.current.get(trackId);
        if (!track || !instrument) continue;
        const pattern = (gridsRef.current[trackId] ?? [])
          .map((on, step) => (on ? { step, pitch: instrument.defaultPitch, velocity: 0.9 } : null))
          .filter((s): s is Step => s !== null);
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
      await gql(ADD_TRACK, {
        input: { songId, name: newTrackName, instrument: newInstrument },
      });
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
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete track");
    }
  }

  if (!song) {
    return (
      <main className="wide">
        {error ? <p className="error">{error}</p> : <p>Loading…</p>}
      </main>
    );
  }

  const sortedTracks = [...song.tracks].sort((a, b) => a.position - b.position);

  return (
    <main className="wide">
      <header className="topbar">
        <div>
          <Link to="/">← Songs</Link>
          <h1>{song.title}</h1>
          <span className="who">{song.bpm} BPM · {song.timeSignature}</span>
        </div>
        <div className="transport">
          <button onClick={() => void togglePlay()}>{playing ? "■ Stop" : "▶ Play"}</button>
          <button onClick={() => void save()} disabled={saving || dirty.size === 0}>
            {saving ? "Saving…" : dirty.size > 0 ? `Save (${dirty.size})` : "Saved"}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="sequencer card">
        {sortedTracks.length === 0 && <p>No tracks yet — add one below and start clicking cells.</p>}
        {sortedTracks.map((track) => (
          <div className="seq-row" key={track.id}>
            <div className="seq-label">
              <strong>{track.name}</strong>
              <span>{track.instrument.toLowerCase()}</span>
              <button className="danger" onClick={() => void removeTrack(track.id)}>×</button>
            </div>
            <div className="seq-cells">
              {Array.from({ length: STEPS }, (_, step) => (
                <button
                  key={step}
                  className={[
                    "cell",
                    grids[track.id]?.[step] ? "on" : "",
                    step === currentStep ? "playhead" : "",
                    step % 4 === 0 ? "beat" : "",
                  ].join(" ")}
                  onMouseDown={(e) => {
                    e.preventDefault(); // no text-selection while painting
                    onCellMouseDown(track.id, step);
                  }}
                  onMouseEnter={() => onCellMouseEnter(track.id, step)}
                  aria-label={`${track.name} step ${step + 1}`}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

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
