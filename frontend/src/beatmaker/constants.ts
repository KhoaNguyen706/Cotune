/**
 * Grid geometry and the pitch axis — the numbers the roll, the rack and the
 * drag math must all agree on.
 *
 * These live in one module rather than in the component because they are shared
 * by code that MUST agree to the pixel: `cellFromEvent` converts a mouse
 * position into a (step, row) using CELL_W/CELL_H, and the rendering derives its
 * inline styles from the same constants. Two copies of "34" in two files is a
 * drag that lands one cell off, and nothing type-checks the disagreement.
 */

export const STEPS = 16;

/** One octave, top-to-bottom like every DAW: high notes up. Sharps get the
 *  dark "black key" row shading. */
export const PITCH_ROWS = ["B", "A#", "A", "G#", "G", "F#", "F", "E", "D#", "D", "C#", "C"];

export const CELL_W = 34;
export const CELL_H = 26;

/** ~20 cursor frames a second while the mouse moves. Fast enough that the CSS
 *  transition has something to interpolate between; slow enough that a mouse
 *  sweep isn't a flood. */
export const CURSOR_THROTTLE_MS = 50;

/**
 * The roll shows TWO octaves, stacked: the lane's octave at the bottom and the
 * next one up above it. One octave was too narrow to write in — a bass line
 * with a fifth above the root, or a melody that leaps, ran straight off the
 * visible grid into "3 notes in other octaves". Two is what fits a laptop
 * screen at CELL_H with the velocity lane and channel rack below it.
 */
export const ROLL_OCTAVES = 2;
export const ROLL_ROWS = PITCH_ROWS.length * ROLL_OCTAVES;

/** Height of the velocity lane under the roll. */
export const VELOCITY_H = 64;

/** Row (0 = top) → pitch, given the lane's octave (the BOTTOM band). */
export function pitchOf(row: number, octave: number): string {
  const band = ROLL_OCTAVES - 1 - Math.floor(row / PITCH_ROWS.length);
  return PITCH_ROWS[row % PITCH_ROWS.length] + (octave + band);
}

/** Pitch → row, or null when it sits outside the visible bands. */
export function rowOf(pitch: string, octave: number): number | null {
  const match = /^([A-G]#?)([0-8])$/.exec(pitch);
  if (!match) return null;
  const band = Number(match[2]) - octave;
  if (band < 0 || band >= ROLL_OCTAVES) return null;
  const within = PITCH_ROWS.indexOf(match[1]);
  if (within < 0) return null;
  return (ROLL_OCTAVES - 1 - band) * PITCH_ROWS.length + within;
}

/** Where a lane's view should open: the octave of its LOWEST note, so the
 *  two visible bands start where the music does — not at the instrument's
 *  default, which left a piano part's low notes "outside" on first open.
 *  Null for an empty lane (the caller falls back to the default). */
export function lowestOctave(notes: { pitch: string }[]): number | null {
  let lowest: number | null = null;
  for (const note of notes) {
    const match = /^[A-G]#?([0-8])$/.exec(note.pitch);
    if (match) lowest = Math.min(lowest ?? 8, Number(match[1]));
  }
  return lowest === null ? null : Math.min(lowest, 8 - (ROLL_OCTAVES - 1));
}

const SEMITONES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "C#3" → 37 (C0 = 0). Transposing a selection is arithmetic on these; the
 *  rows are not, because they are laid out top-down per octave band. */
export function semitoneOf(pitch: string): number | null {
  const match = /^([A-G]#?)([0-8])$/.exec(pitch);
  if (!match) return null;
  return Number(match[2]) * 12 + SEMITONES.indexOf(match[1]);
}

/** The inverse — null outside C0..B8, the range Step accepts server-side. */
export function pitchFromSemitone(semitone: number): string | null {
  if (!Number.isInteger(semitone) || semitone < 0 || semitone > 8 * 12 + 11) return null;
  return SEMITONES[semitone % 12] + Math.floor(semitone / 12);
}

/**
 * Which cell of the grid a mouse event is over, clamped to the grid.
 *
 * `rect` is passed in rather than read from a ref because a drag CAPTURES the
 * geometry at mousedown: the roll can scroll under a drag in progress, and
 * re-reading the rect mid-gesture would make the note jump.
 */
export function cellFromEvent(
  e: MouseEvent | React.MouseEvent,
  rect: DOMRect,
  beatSteps: number,
): { col: number; row: number } {
  const col = Math.max(0, Math.min(beatSteps - 1, Math.floor((e.clientX - rect.left) / CELL_W)));
  const row = Math.max(0, Math.min(ROLL_ROWS - 1, Math.floor((e.clientY - rect.top) / CELL_H)));
  return { col, row };
}
