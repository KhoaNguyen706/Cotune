import * as Tone from "tone";

/**
 * Maps a backend Instrument enum value to something that makes sound.
 *
 * Everything here is SYNTHESIZED by Tone.js in the browser — zero audio
 * files, zero storage, zero download. That's why the beat-maker MVP needs
 * no Supabase bucket: a beat is pattern data (Postgres) + synthesis
 * (client-side). Buckets enter the picture when users upload samples or
 * export rendered audio.
 *
 * `duration` is in SECONDS (the caller converts note length in steps to
 * seconds at the current BPM); undefined means "one sixteenth, now" for
 * edit-time previews.
 */
export interface TrackInstrument {
  trigger(time: number | undefined, pitch: string, velocity: number, duration?: number): void;
  /** Update the lane's persisted mix (V14) on the live audio graph.
   *  Partial on purpose: a volume slider mid-drag shouldn't have to know
   *  the pan. */
  setMix(mix: { volume?: number; pan?: number }): void;
  dispose(): void;
  defaultPitch: string;
  defaultOctave: number;
}

/** The lane's persisted mix: linear gain 0..1, stereo pan -1..1. */
export interface Mix {
  volume: number;
  pan: number;
}

export function createInstrument(instrument: string, mix?: Partial<Mix>): TrackInstrument {
  // Every synth now speaks through a per-lane Channel instead of going
  // straight to the destination — that node IS the mixer strip (V14):
  // volume and pan live there and can move while notes are sounding.
  // gainToDb because users think in linear gain (a fader) while Web Audio
  // volume is dB; gainToDb(0) = -Infinity = truly silent, as it should be.
  const channel = new Tone.Channel({
    volume: Tone.gainToDb(mix?.volume ?? 1),
    pan: mix?.pan ?? 0,
  }).toDestination();

  const base = buildSynth(instrument, channel);
  return {
    ...base,
    setMix: ({ volume, pan }) => {
      if (volume !== undefined) channel.volume.value = Tone.gainToDb(volume);
      if (pan !== undefined) channel.pan.value = pan;
    },
    dispose: () => {
      base.dispose();
      channel.dispose();
    },
  };
}

/** The raw sound sources, each wired into the lane's channel. */
function buildSynth(
  instrument: string,
  out: Tone.ToneAudioNode,
): Omit<TrackInstrument, "setMix"> {
  switch (instrument) {
    case "DRUMS": {
      // MembraneSynth = pitched drum head (kick/tom territory). Drum hits
      // are transient — length affects little, which is musically correct.
      const synth = new Tone.MembraneSynth().connect(out);
      return {
        trigger: (time, pitch, velocity, duration) =>
          synth.triggerAttackRelease(pitch, duration ?? "16n", time, velocity),
        dispose: () => synth.dispose(),
        // C2 (~65 Hz), NOT C1 (~33 Hz): most laptop speakers physically
        // cannot reproduce 33 Hz — a C1 kick is nearly silent on them,
        // which reads as "the play button is broken". Club systems get
        // the sub-octave back via EQ; defaults must work on a laptop.
        defaultPitch: "C2",
        defaultOctave: 2,
      };
    }
    case "BASS": {
      const synth = new Tone.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
      }).connect(out);
      return {
        trigger: (time, pitch, velocity, duration) =>
          synth.triggerAttackRelease(pitch, duration ?? "16n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "C2",
        defaultOctave: 2,
      };
    }
    case "GUITAR": {
      // Karplus-Strong plucked string — decays naturally, ignores duration
      // just like a real pluck would.
      const synth = new Tone.PluckSynth().connect(out);
      return {
        trigger: (time, pitch, _velocity, _duration) => synth.triggerAttack(pitch, time),
        dispose: () => synth.dispose(),
        defaultPitch: "E3",
        defaultOctave: 3,
      };
    }
    case "STRINGS": {
      const synth = new Tone.PolySynth(Tone.AMSynth, {
        envelope: { attack: 0.3, release: 0.8 },
      }).connect(out);
      return {
        trigger: (time, pitch, velocity, duration) =>
          synth.triggerAttackRelease(pitch, duration ?? "8n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "A3",
        defaultOctave: 4,
      };
    }
    case "PIANO": {
      // Tone has no acoustic piano (that genuinely needs samples — a
      // future bucket use-case); AMSynth is a passable electric-piano.
      const synth = new Tone.PolySynth(Tone.AMSynth).connect(out);
      return {
        trigger: (time, pitch, velocity, duration) =>
          synth.triggerAttackRelease(pitch, duration ?? "16n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "C4",
        defaultOctave: 4,
      };
    }
    case "SYNTH":
    default: {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "square" },
      }).connect(out);
      return {
        trigger: (time, pitch, velocity, duration) =>
          synth.triggerAttackRelease(pitch, duration ?? "16n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "C4",
        defaultOctave: 4,
      };
    }
  }
}
