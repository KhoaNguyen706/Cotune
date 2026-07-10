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
 * `defaultPitch` is what a grid cell plays for that instrument — the
 * pattern data model already stores pitch per note, so a future piano-roll
 * UI needs no schema change, only a richer editor.
 */
export interface TrackInstrument {
  trigger(time: number | undefined, pitch: string, velocity: number): void;
  dispose(): void;
  defaultPitch: string;
}

export function createInstrument(instrument: string): TrackInstrument {
  switch (instrument) {
    case "DRUMS": {
      // MembraneSynth = pitched drum head (kick/tom territory).
      const synth = new Tone.MembraneSynth().toDestination();
      return {
        trigger: (time, pitch, velocity) =>
          synth.triggerAttackRelease(pitch, "16n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "C1",
      };
    }
    case "BASS": {
      const synth = new Tone.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
      }).toDestination();
      return {
        trigger: (time, pitch, velocity) =>
          synth.triggerAttackRelease(pitch, "16n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "C2",
      };
    }
    case "GUITAR": {
      // Karplus-Strong plucked-string physical model — the most
      // guitar-ish thing available without samples.
      const synth = new Tone.PluckSynth().toDestination();
      return {
        trigger: (time, pitch, _velocity) => synth.triggerAttack(pitch, time),
        dispose: () => synth.dispose(),
        defaultPitch: "E3",
      };
    }
    case "STRINGS": {
      const synth = new Tone.PolySynth(Tone.AMSynth, {
        envelope: { attack: 0.3, release: 0.8 },
      }).toDestination();
      return {
        trigger: (time, pitch, velocity) =>
          synth.triggerAttackRelease(pitch, "8n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "A3",
      };
    }
    case "PIANO": {
      // Tone has no acoustic piano (that genuinely needs samples — a
      // future bucket use-case); AMSynth is a passable electric-piano.
      const synth = new Tone.PolySynth(Tone.AMSynth).toDestination();
      return {
        trigger: (time, pitch, velocity) =>
          synth.triggerAttackRelease(pitch, "16n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "C4",
      };
    }
    case "SYNTH":
    default: {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "square" },
      }).toDestination();
      return {
        trigger: (time, pitch, velocity) =>
          synth.triggerAttackRelease(pitch, "16n", time, velocity),
        dispose: () => synth.dispose(),
        defaultPitch: "C4",
      };
    }
  }
}
