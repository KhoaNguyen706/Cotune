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
  dispose(): void;
  defaultPitch: string;
  defaultOctave: number;
}

export function createInstrument(instrument: string): TrackInstrument {
  switch (instrument) {
    case "DRUMS": {
      // MembraneSynth = pitched drum head (kick/tom territory). Drum hits
      // are transient — length affects little, which is musically correct.
      const synth = new Tone.MembraneSynth().toDestination();
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
      }).toDestination();
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
      const synth = new Tone.PluckSynth().toDestination();
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
      }).toDestination();
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
      const synth = new Tone.PolySynth(Tone.AMSynth).toDestination();
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
      }).toDestination();
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
