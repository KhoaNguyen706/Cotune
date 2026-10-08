import type { Step } from "../types";
import { pitchFromSemitone, rowOf, semitoneOf } from "./constants";

/**
 * Multi-note editing, as pure functions over one lane's notes.
 *
 * Pure on purpose: every gesture in the piano roll (drag a selection, nudge
 * it with the arrows, paste, duplicate, paint velocities) is "old notes in,
 * new notes out", and the rules worth getting right — what a collision
 * means, what happens at the edge of the beat — live here where a test can
 * reach them without a browser. The hook only decides WHEN to call these and
 * pushes the result through the same setNotes → dirty → delta path every
 * other edit takes, so collaborators see a paste arrive as ordinary ADDs.
 *
 * NOTES ARE IDENTIFIED BY (step, pitch), not by array index. The server
 * enforces that pair as unique within a lane, and unlike an index it does
 * not shift when a collaborator's note lands mid-gesture — a selection held
 * by index would silently start pointing at somebody else's note.
 */

export type NoteKey = string;

export const keyOf = (note: Pick<Step, "step" | "pitch">): NoteKey => `${note.step}|${note.pitch}`;

/**
 * Move and/or transpose the selected notes as one block.
 *
 * All or nothing: if any note would leave the beat, leave the C0..B8 range,
 * or land on a note that is NOT moving, the whole move is refused (null).
 * Half a chord sliding while the other half stays is never what anyone
 * meant; refusing keeps the block's shape and the user simply sees it stop
 * at the wall.
 */
export function shiftNotes(
  notes: Step[],
  selected: ReadonlySet<NoteKey>,
  deltaSteps: number,
  deltaSemitones: number,
  beatSteps: number,
): { notes: Step[]; selected: Set<NoteKey> } | null {
  if (selected.size === 0 || (deltaSteps === 0 && deltaSemitones === 0)) return null;
  const staying = notes.filter((note) => !selected.has(keyOf(note)));
  const occupied = new Set(staying.map(keyOf));
  const moved: Step[] = [];
  for (const note of notes) {
    if (!selected.has(keyOf(note))) continue;
    const step = note.step + deltaSteps;
    const semitone = semitoneOf(note.pitch);
    const pitch = semitone === null ? null : pitchFromSemitone(semitone + deltaSemitones);
    if (pitch === null || step < 0 || step + note.length > beatSteps) return null;
    if (occupied.has(keyOf({ step, pitch }))) return null;
    moved.push({ ...note, step, pitch });
  }
  return { notes: [...staying, ...moved], selected: new Set(moved.map(keyOf)) };
}

/**
 * Change the length of every selected note by the same amount — per note
 * clamped to at least one step and to the end of the beat, because a
 * selection of mixed lengths should all grow, not all stop at the first one
 * that hits the wall.
 */
export function resizeNotes(
  notes: Step[],
  selected: ReadonlySet<NoteKey>,
  deltaLength: number,
  beatSteps: number,
): Step[] {
  return notes.map((note) =>
    selected.has(keyOf(note))
      ? { ...note, length: Math.max(1, Math.min(beatSteps - note.step, note.length + deltaLength)) }
      : note,
  );
}

export function deleteNotes(notes: Step[], selected: ReadonlySet<NoteKey>): Step[] {
  return notes.filter((note) => !selected.has(keyOf(note)));
}

/** What Ctrl+C holds: notes relative to the block's first step, plus how
 *  long the block is (so Ctrl+D knows where "right after it" is). Pitches
 *  stay absolute — paste into another lane and the melody comes along. */
export interface CopiedNotes {
  notes: Step[];
  span: number;
}

export function copyNotes(notes: Step[], selected: ReadonlySet<NoteKey>): CopiedNotes | null {
  const picked = notes.filter((note) => selected.has(keyOf(note)));
  if (picked.length === 0) return null;
  const start = Math.min(...picked.map((note) => note.step));
  const end = Math.max(...picked.map((note) => note.step + note.length));
  return {
    notes: picked.map((note) => ({ ...note, step: note.step - start })),
    span: end - start,
  };
}

/**
 * Drop copied notes at `atStep`.
 *
 * A pasted note OVERWRITES one already at the same step and pitch — the same
 * upsert the server's ADD op does, so the editor and the wire agree on what
 * a paste means. Notes that would run past the end of the beat are dropped,
 * not squashed: a shortened note is a different note.
 */
export function pasteNotes(
  notes: Step[],
  copied: CopiedNotes,
  atStep: number,
  beatSteps: number,
): { notes: Step[]; selected: Set<NoteKey> } {
  const incoming = copied.notes
    .map((note) => ({ ...note, step: note.step + atStep }))
    .filter((note) => note.step >= 0 && note.step + note.length <= beatSteps);
  const replaced = new Set(incoming.map(keyOf));
  return {
    notes: [...notes.filter((note) => !replaced.has(keyOf(note))), ...incoming],
    selected: replaced,
  };
}

/** Ctrl+D: a copy of the selection placed immediately after itself. */
export function duplicateNotes(
  notes: Step[],
  selected: ReadonlySet<NoteKey>,
  beatSteps: number,
): { notes: Step[]; selected: Set<NoteKey> } | null {
  const copied = copyNotes(notes, selected);
  if (!copied) return null;
  const start = Math.min(...notes.filter((note) => selected.has(keyOf(note))).map((note) => note.step));
  return pasteNotes(notes, copied, start + copied.span, beatSteps);
}

/** The notes a marquee covers: any note whose START cell is inside the box
 *  (steps and rows inclusive) — how FL and Ableton both decide it. */
export function notesInBox(
  notes: Step[],
  octave: number,
  box: { stepFrom: number; stepTo: number; rowFrom: number; rowTo: number },
): Set<NoteKey> {
  const picked = new Set<NoteKey>();
  for (const note of notes) {
    const row = rowOf(note.pitch, octave);
    if (row === null) continue;
    if (note.step >= box.stepFrom && note.step <= box.stepTo && row >= box.rowFrom && row <= box.rowTo) {
      picked.add(keyOf(note));
    }
  }
  return picked;
}

/** The server accepts (0, 1]; the floor keeps a painted note audible. */
export const MIN_VELOCITY = 0.05;

/**
 * Velocity painting: set every note that STARTS at `step` to `velocity`.
 * With a selection, only selected notes change — so you can shape a hi-hat
 * line without flattening the kick that shares its steps.
 */
export function paintVelocity(
  notes: Step[],
  step: number,
  velocity: number,
  selected: ReadonlySet<NoteKey>,
): Step[] {
  const value = Math.round(Math.max(MIN_VELOCITY, Math.min(1, velocity)) * 100) / 100;
  return notes.map((note) =>
    note.step === step && (selected.size === 0 || selected.has(keyOf(note))) && note.velocity !== value
      ? { ...note, velocity: value }
      : note,
  );
}
