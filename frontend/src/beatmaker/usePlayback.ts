import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
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
import type { Beat, Clip, Song, Step } from "../types";
import { STEPS } from "./constants";
import type { Instruments } from "./useInstruments";

export interface Playback {
  playing: boolean;
  /** Beat-loop playhead (0..steps-1). */
  currentStep: number;
  /** Arrangement playhead (absolute step). */
  arrangeStep: number;
  muted: Set<string>;
  soloed: Set<string>;
  volume: number;
  exporting: boolean;
  setMuted: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSoloed: React.Dispatch<React.SetStateAction<Set<string>>>;
  setVolume: (v: number) => void;
  togglePlay: () => Promise<void>;
  stop: () => void;
  testSound: () => Promise<void>;
  exportAs: (format: "wav" | "mp3") => Promise<void>;
  /** Audition a single note (used while drawing and dragging). */
  preview: (trackId: string, pitch: string, velocity?: number) => void;
}

/**
 * The transport: Tone.js, the two playheads, mute/solo, and export.
 *
 * It reads the song through REFS, not props, and that is the whole reason this
 * works: a scheduled Tone callback is created once when playback starts and then
 * fires ~20 times a second for as long as the loop runs. Closing over `notes`
 * would freeze it against whatever the grid held at the moment you pressed play,
 * so notes drawn mid-loop would be silent — you'd hear the beat you had, not the
 * beat you have.
 */
export function usePlayback(params: {
  song: Song | null;
  mode: "arrange" | "beats";
  instruments: Instruments;
  notesRef: React.MutableRefObject<Record<string, Step[]>>;
  clipsRef: React.MutableRefObject<Clip[]>;
  beatsRef: React.MutableRefObject<Beat[]>;
  selectedBeatIdRef: React.MutableRefObject<string | null>;
  onError: (message: string) => void;
}): Playback {
  const { song, mode, instruments, notesRef, clipsRef, beatsRef, selectedBeatIdRef, onError } = params;

  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [arrangeStep, setArrangeStep] = useState(-1);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [soloed, setSoloed] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [volume, setVolumeState] = useState(80);

  const playersRef = useRef<Tone.Player[]>([]);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const soloedRef = useRef(soloed);
  soloedRef.current = soloed;

  // Tone lives outside React and will happily keep playing a disposed page.
  // (Instruments are disposed by useInstruments — it owns them.)
  useEffect(() => {
    const players = playersRef;
    return () => {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      for (const player of players.current) {
        player.unsync();
        player.dispose();
      }
      players.current = [];
    };
  }, []);

  // Master volume, 0-100 mapped to decibels on Tone's destination node.
  // gainToDb is logarithmic — perceived loudness, not linear amplitude
  // (a linear volume slider feels "all in the last 10%").
  function setVolume(v: number) {
    setVolumeState(v);
    Tone.getDestination().volume.value = v === 0 ? -Infinity : Tone.gainToDb(v / 100);
  }

  /** Solo wins over mute, DAW-standard: if ANY lane is soloed, only
   *  soloed lanes sound; otherwise everything not muted sounds. */
  function isAudible(trackId: string): boolean {
    return soloedRef.current.size > 0
      ? soloedRef.current.has(trackId)
      : !mutedRef.current.has(trackId);
  }

  function stop() {
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
      onError("The timeline is empty — arm a beat in the left palette and click a lane to place it.");
      return;
    }
    await Tone.start();
    const transport = Tone.getTransport();
    transport.bpm.value = sources.bpm;
    const buffers = await prefetchBuffers(sources.clips);
    playersRef.current = scheduleArrangement({
      sources,
      instruments: instruments.map.current,
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
      Tone.getDraw().schedule(() => stop(), time);
    }, end + 0.1);
    transport.start();
    setPlaying(true);
  }

  async function playBeatLoop() {
    if (!song) return;
    const beat = beatsRef.current.find((b) => b.id === selectedBeatIdRef.current);
    if (!beat) {
      onError("No beat selected — create one first.");
      return;
    }
    // Pressing play on a silent beat is the #1 "sound is broken" report —
    // say why instead of sweeping an empty playhead in silence.
    const totalNotes = beat.tracks.reduce(
      (n, lane) => n + (notesRef.current[lane.id]?.length ?? 0), 0);
    if (totalNotes === 0) {
      onError(`"${beat.name}" has no notes yet — click cells in the piano roll below, then press play.`);
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
              instruments.map.current
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
      stop();
      return;
    }
    if (mode === "arrange") await playArrangement();
    else await playBeatLoop();
  }

  async function exportAs(format: "wav" | "mp3") {
    const sources = currentSources();
    if (!sources || !song) return;
    if (arrangementEndSeconds(sources) === 0) {
      onError("Nothing to export — place beats or audio on the timeline first.");
      return;
    }
    setExporting(true);
    try {
      const buffers = await prefetchBuffers(sources.clips);
      // One offline render, then the format is just an encoder choice.
      const rendered = await renderArrangement(sources, buffers);
      const blob = format === "wav" ? encodeWav(rendered) : encodeMp3(rendered);
      const safeTitle = song.title.replace(/[^\w\- ]+/g, "").trim() || "cotune-song";
      downloadBlob(blob, `${safeTitle}.${format}`);
    } catch {
      onError("Export failed — try playing the arrangement once, then export again.");
    } finally {
      setExporting(false);
    }
  }

  return {
    playing,
    currentStep,
    arrangeStep,
    muted,
    soloed,
    volume,
    exporting,
    setMuted,
    setSoloed,
    setVolume,
    togglePlay,
    stop,
    // One-click "is my audio path alive?" — a mid-range blip no speaker can
    // miss. Debugging affordance for the user, not a musical feature: it
    // separates "app is broken" from "tab/OS is muted" instantly.
    testSound: async () => {
      await Tone.start();
      const synth = new Tone.Synth().toDestination();
      synth.triggerAttackRelease("C5", "8n");
      setTimeout(() => synth.dispose(), 1000);
    },
    exportAs,
    preview: (trackId, pitch, velocity = 0.9) =>
      instruments.map.current.get(trackId)?.trigger(undefined, pitch, velocity),
  };
}
