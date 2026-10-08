/**
 * Lane caps — the colored caps on a console's faders. A real DAW convention
 * (Ableton/FL/Logic all do it): each instrument family gets a stable color,
 * used wherever that lane appears (its strip, its rack row, its clips).
 * Color becomes a second, pre-attentive channel for "which lane is this" —
 * you stop reading labels and start recognizing lanes.
 *
 * Returned as CSS variables, not hexes, because a cap that reads on the
 * light chassis disappears on the night panel: styles.css defines each
 * --color-lane-N twice, and every consumer here is an inline style, so the
 * theme switch re-colors them with no JS. The palette deliberately avoids
 * the beat-key hues (red/orange/yellow mean "which beat") and violet.
 */
const lane = (n: number) => `var(--color-lane-${n})`;

export const INSTRUMENT_COLORS: Record<string, string> = {
  DRUMS: lane(4), //   walnut — the wooden shell
  BASS: lane(1), //    cobalt — low end
  SYNTH: lane(2), //   teal   — leads
  PIANO: lane(6), //   steel  — keys
  GUITAR: lane(5), //  berry  — plucked strings
  STRINGS: lane(3), // moss   — bowed strings
};

export function colorFor(instrument: string): string {
  return INSTRUMENT_COLORS[instrument] ?? lane(6);
}

/**
 * Beat colors — a beat groups many instruments, so it gets a cap by
 * POSITION (Beat 1 is always the same color in the strip, the timeline,
 * everywhere). Same six caps as the lanes: a clip and a lane are told
 * apart by where they sit, and a second palette would only add hues that
 * mean nothing new.
 */
export function beatColor(position: number): string {
  return lane((((position % 6) + 6) % 6) + 1);
}
