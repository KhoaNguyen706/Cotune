import * as Tone from "tone";

/**
 * The song's two shared effects — one reverb, one delay — and the inputs
 * every lane's sends feed (V17).
 *
 * SEND/RETURN, the mixing-desk model: a lane does not own a reverb, it owns
 * a knob for how much of itself goes INTO the shared one. One room for the
 * whole beat is what makes a mix sound like one performance, and it costs
 * one reverb's CPU however many lanes there are. The effects are 100% wet;
 * the dry signal still goes straight to the master from each lane, so a
 * send of 0 is exactly the sound before V17.
 *
 * ONE BUS PER AUDIO CONTEXT. Live playback and the offline export render
 * run in different Web Audio contexts, and a node can only connect to nodes
 * in its own context — so this cannot be a module-level singleton (and is
 * why Tone's built-in Channel.send/receive, a global name registry, isn't
 * used: it would wire an offline lane into the live reverb). The WeakMap
 * keys a bus to whichever context is current when an instrument is built.
 */
export interface FxBus {
  reverb: Tone.InputNode;
  delay: Tone.InputNode;
  /** The reverb's impulse response is generated asynchronously; an offline
   *  render must wait for it or the first second renders dry. */
  ready: Promise<void>;
  /** Keep the echoes on the beat: a dotted eighth at the song's tempo. */
  setTempo: (bpm: number) => void;
}

const buses = new WeakMap<object, FxBus>();

export function fxBusFor(context: Tone.BaseContext = Tone.getContext()): FxBus {
  const existing = buses.get(context);
  if (existing) return existing;

  // A medium room: long enough to hear on a snare, short enough that a
  // 140 BPM hat line doesn't smear into a wash.
  const reverb = new Tone.Reverb({ decay: 2.4, preDelay: 0.01, wet: 1, context }).toDestination();
  // Echoes are filtered so repeats sit behind the dry sound instead of
  // competing with it — the reason hardware tape delays sound "musical".
  const tone = new Tone.Filter({ frequency: 3200, type: "lowpass", context }).toDestination();
  const delay = new Tone.FeedbackDelay({ delayTime: 0.375, feedback: 0.32, wet: 1, context }).connect(tone);

  const bus: FxBus = {
    reverb,
    delay,
    ready: reverb.ready,
    setTempo: (bpm) => {
      delay.delayTime.value = (60 / bpm) * 0.75;
    },
  };
  buses.set(context, bus);
  return bus;
}
