/**
 * Track colors — a real DAW convention (Ableton/FL/Logic all do it): each
 * instrument family gets a stable hue, used everywhere that track appears
 * (list row, mini preview, piano-roll notes). Color becomes a second,
 * pre-attentive channel for "which track is this" — you stop reading
 * labels and start recognizing lanes.
 *
 * Hues are spread around the wheel and kept at similar lightness so no
 * track shouts louder than another on the dark background.
 */
export const INSTRUMENT_COLORS: Record<string, string> = {
  DRUMS: "#f5a524", // amber  — percussion
  BASS: "#9b7bff", //  violet — low end
  SYNTH: "#38bdf8", //  sky    — leads
  PIANO: "#34d399", //  emerald— keys
  GUITAR: "#fb7185", // rose   — strings, plucked
  STRINGS: "#a3e635", // lime  — strings, bowed
};

export function colorFor(instrument: string): string {
  return INSTRUMENT_COLORS[instrument] ?? "#8b7cf8";
}
