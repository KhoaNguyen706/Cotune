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
  swingOffset,
  type ArrangementSources,
} from "../audio/engine";
import { fxBusFor } from "../audio/fx";
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
  exportAs: (format: "wav" | "mp3") => Promise<void>;
  /** Audition a single note (used while drawing and dragging). */
  preview: (trackId: string, pitch: string, velocity?: number) => void;
}

/** A loop range on the arrangement, in steps, end exclusive. */
export interface LoopRegion {
  startStep: number;
  endStep: number;
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
  /** Click on every beat while playing. Read at click time, so toggling it
   *  mid-playback takes effect on the next beat. */
  metronome: boolean;
  /** One bar of clicks before the transport starts. */
  countIn: boolean;
  /** The arrangement loop, or null to play through to the end. A personal
   *  transport setting, not song data — see the page. */
  loop: LoopRegion | null;
}): Playback {
  const { song, mode, instruments, notesRef, clipsRef, beatsRef, selectedBeatIdRef, onError } = params;
  const metronomeRef = useRef(params.metronome);
  metronomeRef.current = params.metronome;
  const countInRef = useRef(params.countIn);
  countInRef.current = params.countIn;
  const loopRef = useRef(params.loop);
  loopRef.current = params.loop;

  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [arrangeStep, setArrangeStep] = useState(-1);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [soloed, setSoloed] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [volume, setVolumeState] = useState(80);

  const playersRef = useRef<Tone.Player[]>([]);
  /** The metronome's voice — built on first use, never routed through the
   *  effect sends (a reverberant click is a click you can't place). */
  const clickRef = useRef<Tone.Synth | null>(null);
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
      clickRef.current?.dispose();
      clickRef.current = null;
    };
  }, []);

  // The shared delay's echoes are a dotted eighth at the song's tempo; keep
  // them on the beat when the BPM changes, playing or not.
  useEffect(() => {
    if (song) fxBusFor().setTempo(song.bpm);
  }, [song?.bpm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loop edits while the arrangement is playing apply on the spot: Tone's
  // transport loop points are live, so there is no need to restart.
  useEffect(() => {
    if (!playing || mode !== "arrange" || !song) return;
    applyLoop(Tone.getTransport(), secondsPerStep(song.bpm));
  }, [params.loop, playing]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function click(time: number, accent: boolean) {
    clickRef.current ??= new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      volume: -4,
    }).toDestination();
    try {
      // The bar's downbeat is pitched up: the ear counts bars by it.
      clickRef.current.triggerAttackRelease(accent ? "A5" : "E5", 0.03, time);
    } catch {
      // a monophonic voice refuses two clicks on one tick; skip the second
    }
  }

  /** One click per quarter, on the TRANSPORT's position — so it lines up
   *  with the grid through loops and seeks, not with a counter that would
   *  drift the moment the loop jumps back. */
  function scheduleMetronome(transport: ReturnType<typeof Tone.getTransport>) {
    const ticksPerStep = transport.PPQ / 4;
    transport.scheduleRepeat((time) => {
      if (!metronomeRef.current) return;
      const step = Math.round(transport.getTicksAtTime(time) / ticksPerStep);
      click(time, step % STEPS === 0);
    }, "4n", 0);
  }

  /**
   * Start the transport, after a bar of count-in clicks if that is on.
   *
   * The count-in is NOT on the transport: the clicks are scheduled straight
   * onto the audio clock and the transport is told to start four beats
   * later. That keeps every scheduled note, the loop points and the
   * playhead in plain song time — nothing has to be shifted by a bar.
   */
  function startTransport(offsetSeconds: number) {
    const transport = Tone.getTransport();
    const now = Tone.now() + 0.05;
    let startAt = now;
    if (countInRef.current) {
      const beat = 60 / transport.bpm.value;
      for (let i = 0; i < 4; i++) click(now + i * beat, i === 0);
      startAt = now + 4 * beat;
    }
    transport.start(startAt, offsetSeconds);
  }

  /** Point the transport's loop at the region, or turn looping off. */
  function applyLoop(transport: ReturnType<typeof Tone.getTransport>, perStep: number): number {
    const region = loopRef.current;
    if (region && region.endStep > region.startStep) {
      transport.setLoopPoints(region.startStep * perStep, region.endStep * perStep);
      transport.loop = true;
      return region.startStep * perStep;
    }
    transport.loop = false;
    return 0;
  }

  function stop() {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    Tone.getTransport().loop = false;
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
    // Nothing placed: the Play button is disabled with a tooltip saying so
    // (canPlay in the page), so this only catches the spacebar.
    if (end === 0) return;
    await Tone.start();
    const transport = Tone.getTransport();
    transport.bpm.value = sources.bpm;
    fxBusFor().setTempo(sources.bpm);
    const perStep = secondsPerStep(sources.bpm);
    const buffers = await prefetchBuffers(sources.clips);
    playersRef.current = scheduleArrangement({
      sources,
      instruments: instruments.map.current,
      buffers,
      audible: isAudible,
    });
    // The playhead reads the transport's POSITION rather than counting
    // ticks of its own: with a loop region the position jumps back, and a
    // counter would sweep on past the loop's end.
    const ticksPerStep = transport.PPQ / 4;
    transport.scheduleRepeat((time) => {
      const current = Math.floor(transport.getTicksAtTime(time) / ticksPerStep + 1e-6);
      Tone.getDraw().schedule(() => setArrangeStep(current), time);
    }, perStep, 0);
    // Auto-stop at the right edge — unless a loop is on by then, which can
    // happen mid-play (toggling the loop doesn't restart anything).
    transport.schedule((time) => {
      if (transport.loop) return;
      Tone.getDraw().schedule(() => stop(), time);
    }, end + 0.1);
    scheduleMetronome(transport);
    startTransport(applyLoop(transport, perStep));
    setPlaying(true);
  }

  async function playBeatLoop() {
    if (!song) return;
    const beat = beatsRef.current.find((b) => b.id === selectedBeatIdRef.current);
    // Pressing play on a silent beat is the #1 "sound is broken" report. The
    // answer is a disabled Play button that says why (canPlay in the page),
    // not a red banner after the fact; this guard only catches the spacebar.
    const totalNotes = beat?.tracks.reduce(
      (n, lane) => n + (notesRef.current[lane.id]?.length ?? 0), 0) ?? 0;
    if (totalNotes === 0) return;
    await Tone.start();
    Tone.getTransport().bpm.value = song.bpm;
    Tone.getTransport().loop = false; // the beat loop counts its own steps
    fxBusFor().setTempo(song.bpm);
    let step = 0;
    Tone.getTransport().scheduleRepeat((time) => {
      // Loop the SELECTED beat only — this view is the beat workbench;
      // hearing the whole song is what the Arrange tab is for.
      const looping = beatsRef.current.find((b) => b.id === selectedBeatIdRef.current);
      const current = step % ((looping?.bars ?? 1) * STEPS);
      const sixteenth = Tone.Time("16n").toSeconds();
      // Off-beats land late by the beat's swing; the playhead stays on the
      // grid, because it shows WHERE you are, not when the note sounds.
      const late = swingOffset(current, looping?.swing, sixteenth);
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
                ?.trigger(time + late, note.pitch, note.velocity, note.length * sixteenth);
            } catch {
              // skip the colliding note; the rest of the tick still plays
            }
          }
        }
      }
      Tone.getDraw().schedule(() => setCurrentStep(current), time);
      step++;
    }, "16n");
    scheduleMetronome(Tone.getTransport());
    startTransport(0);
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
    if (arrangementEndSeconds(sources) === 0) return; // buttons are disabled
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
    exportAs,
    preview: (trackId, pitch, velocity = 0.9) =>
      instruments.map.current.get(trackId)?.trigger(undefined, pitch, velocity),
  };
}
