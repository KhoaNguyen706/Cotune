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

export function pitchOf(row: number, octave: number): string {
  return PITCH_ROWS[row] + octave;
}

export function rowOf(pitch: string, octave: number): number | null {
  const match = /^([A-G]#?)([0-8])$/.exec(pitch);
  if (!match || Number(match[2]) !== octave) return null;
  const row = PITCH_ROWS.indexOf(match[1]);
  return row >= 0 ? row : null;
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
  const row = Math.max(0, Math.min(PITCH_ROWS.length - 1, Math.floor((e.clientY - rect.top) / CELL_H)));
  return { col, row };
}
